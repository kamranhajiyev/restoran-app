// Statistika and Kassa count their money in lib/statistics and lib/shift-cash,
// one place each, with sums worked out by hand. Until 2026-11-01 the admin page
// and the till each did these sums inline, and no test could reach them.
// İXLAS CAFE, 2026-10-31, checked against the database: 137 orders, 714.50 ₼,
// drawer 0 + 453.70 cash − 527.20 movements = −73.50, as the shift saved.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MenuItem, Order, ShiftMovement } from '@/types';
import {
  categoryReport, costMap, ordersInDays, revenue, revenueByHour, revenueByWeekday, sellerStats, statsSummary,
} from '@/lib/statistics';
import { cardSalesToSave, expectedCash, movementsIn, movementsOut, movementsTotal, paymentTooMuch } from '@/lib/shift-cash';
import type { CompanySettings } from '@/lib/business-day';

const BAKU: CompanySettings = { timezone: 'Asia/Baku', workOpen: '08:00', workClose: '02:00' };

const item = (id: string, price: number, category: string, extra: Partial<MenuItem> = {}): MenuItem =>
  ({ id, name: id, price, category, available: true, ...extra });
const tea = item('tea', 2, 'İçki', { costPrice: 0.5 });
const kebab = item('kebab', 10, 'Yemək', { costPrice: 4 });
const salad = item('salad', 5, 'Yemək'); // no cost entered

let n = 0;
const order = (createdAt: string, lines: [MenuItem, number][], extra: Partial<Order> = {}): Order => ({
  id: String(++n), orderNumber: n, tableNumber: 1, status: 'ödənilib', createdAt,
  items: lines.map(([menuItem, quantity]) => ({ menuItem, quantity })),
  ...extra,
} as Order);

// Baku is UTC+4. 10:30, 10:45 and 19:10 on Saturday 31 October; 01:30 after
// midnight still belongs to the 31st (the day rolls over at 02:00).
const a = order('2026-10-31T06:30:00Z', [[tea, 2], [kebab, 1]], { sellerName: 'Elşad' });            // 14
const b = order('2026-10-31T06:45:00Z', [[salad, 2]], { sellerName: 'Hüseyn', discountAmount: 1 });  // 9
const c = order('2026-10-31T15:10:00Z', [[kebab, 2]], { sellerName: 'Elşad', serviceChargePercent: 10 }); // 22
const late = order('2026-10-31T21:30:00Z', [[tea, 1]], { sellerName: 'Hüseyn' });                    // 2
const nextDay = order('2026-10-31T22:30:00Z', [[tea, 5]]);                                          // 10, on 1 Nov
const day = [a, b, c, late];

describe('Statistika', () => {
  it('a day is the business day: after midnight counts until closing time', () => {
    expect(ordersInDays([...day, nextDay], BAKU, '2026-10-31', '2026-10-31')).toEqual(day);
    expect(ordersInDays([...day, nextDay], BAKU, '2026-11-01', '2026-11-01')).toEqual([nextDay]);
  });

  it('revenue is dishes plus service charge less discount', () => {
    expect(revenue(day)).toBe(14 + 9 + 22 + 2);
  });

  it('cost, profit, margin and average', () => {
    const s = statsSummary(day, costMap([tea, kebab, salad]));
    // tea 3 × 0.5 + kebab 3 × 4; the salad has no cost and counts 0
    expect(s).toEqual({ revenue: 47, cost: 13.5, profit: 33.5, marginPct: 33.5 / 47 * 100, avg: 47 / 4 });
  });

  it('a product without its own cost takes its sizes’ average', () => {
    const coffee = item('coffee', 3, 'İçki', { variants: [
      { id: 's', name: 'S', price: 3, costPrice: 1 }, { id: 'l', name: 'L', price: 4, costPrice: 2 },
      { id: 'xl', name: 'XL', price: 5 },
    ] });
    expect(costMap([coffee, salad])).toEqual({ coffee: 1.5, s: 1, l: 2 });
  });

  it('the hours and the weekdays add up to the same revenue', () => {
    const hours = revenueByHour(day, BAKU.timezone);
    expect(hours[10]).toBe(23);
    expect(hours[19]).toBe(22);
    expect(hours[1]).toBe(2);
    expect(hours.reduce((s, r) => s + r, 0)).toBe(revenue(day));

    const days = revenueByWeekday(day, BAKU);
    expect(days[5]).toBe(47); // Saturday, even the order at 01:30 on Sunday
    expect(days.reduce((s, r) => s + r, 0)).toBe(revenue(day));
  });

  it('sellers add up to the revenue, best first', () => {
    expect(sellerStats([...day, nextDay])).toEqual([
      { name: 'Elşad', orders: 2, rev: 36 },
      { name: 'Hüseyn', orders: 2, rev: 11 },
      { name: 'Naməlum', orders: 1, rev: 10 },
    ]);
  });

  it('categories share the discount and leave the service charge out', () => {
    const cats = categoryReport(day, [tea, kebab, salad], costMap([tea, kebab, salad]));
    const yemek = cats.find(x => x.cat === 'Yemək')!;
    const icki = cats.find(x => x.cat === 'İçki')!;
    expect(icki.rev).toBeCloseTo(4 + 2, 9);
    expect(yemek.rev).toBeCloseTo(10 + 9 + 20, 9);
    // categories + Xidmət haqqı (2 ₼ on order c) = revenue
    expect(icki.rev + yemek.rev + 2).toBeCloseTo(revenue(day), 9);
    expect(cats[0].cat).toBe('Yemək');
  });
});

const move = (amount: number): ShiftMovement => ({ id: String(amount), at: '', by: '', amount, reason: '' });

describe('Kassa drawer', () => {
  it('opening cash + cash sales + movements; card stays out', () => {
    const shift = { openingCash: 50, movements: [move(20), move(-5), move(-10)] };
    expect(movementsIn(shift)).toBe(20);
    expect(movementsOut(shift)).toBe(-15);
    expect(movementsTotal(shift)).toBe(5);
    expect(expectedCash(shift, 100)).toBe(155);
  });

  it('İXLAS CAFE, 31 October: 0 + 453.70 − 527.20 = −73.50', () => {
    const shift = { openingCash: 0, movements: [-3.4, -6, 45, -39.1, -12, -3, -20, -200, -50, -30, -20, -80, -50, -3, -20, -20, -15.7].map(move) };
    expect(movementsTotal(shift)).toBeCloseTo(-527.2, 9);
    expect(expectedCash(shift, 453.7)).toBe(-73.5);
  });

  it('card sales are saved to the qəpik, not 215.79999999999995', () => {
    expect(cardSalesToSave(215.79999999999995)).toBe(215.8);
    expect(cardSalesToSave(0.1 + 0.2)).toBe(0.3);
  });

  it('admin’s payment edit takes 6.40 + 1.20 on a 7.60 order', () => {
    expect(6.4 + 1.2 > 7.6).toBe(true); // what the old check did
    expect(paymentTooMuch(6.4, 1.2, 7.6)).toBe(false);
    expect(paymentTooMuch(6.4, 1.21, 7.6)).toBe(true);
  });

  it('is saved to the qəpik, not 0.09999999999999432', () => {
    // İXLAS CAFE, 4 October: 0.1 in the drawer was saved with float dust
    expect(expectedCash({ openingCash: 0.1, movements: [move(0.2)] }, 0)).toBe(0.3);
    expect(expectedCash({ openingCash: 0, movements: [move(-3.4), move(-6)] }, 9.5)).toBe(0.1);
  });
});

describe('no screen counts on its own', () => {
  const admin = readFileSync('app/admin/page.tsx', 'utf8');
  const seller = readFileSync('app/seller/page.tsx', 'utf8');

  it('Statistika sums come from lib/statistics', () => {
    expect(admin).not.toMatch(/reduce\(\(s, o\) => s \+ orderTotal\(o\), 0\)/);
    expect(admin).not.toMatch(/const menuCostMap: Record/);
    expect(admin).toMatch(/from '@\/lib\/statistics'/);
  });

  it('the drawer is counted in lib/shift-cash on the till and in admin', () => {
    for (const src of [admin, seller]) {
      expect(src).not.toMatch(/movements\.reduce\(/);
      expect(src).not.toMatch(/openingCash \+/);
      expect(src).toMatch(/from '@\/lib\/shift-cash'/);
      // a shift closes on rounded card sales, never the raw sum
      expect(src).not.toMatch(/closeShift\([^)]*, sales\.card,/);
    }
    expect(seller).toMatch(/cardSales: cardSalesToSave\(sales\.card\)/);
    expect(admin).toMatch(/if \(paymentTooMuch\(cash, card, total\)\)/);
  });
});

// Tarixçə's printed Hesabat must say what the boxes on the screen say, and
// keep cancelled and returned orders apart from the sales.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { historyReport, historyReportLines } from '@/lib/history-report';
import { historyTotals } from '@/lib/history-shifts';

type O = { id: string; status: string; t: number; discountAmount?: number; cashAmount?: number; cardAmount?: number;
  courierDebt?: number; courierCash?: number; courierCard?: number };
const total = (o: O) => o.t;

const orders: O[] = [
  { id: 'a', status: 'ödənilib', t: 18, discountAmount: 2, cashAmount: 18 },
  { id: 'b', status: 'ödənilib', t: 10, cashAmount: 4, cardAmount: 6 },
  { id: 'c', status: 'ödənilib', t: 12, courierDebt: 12 },                 // rider still has it
  { id: 'd', status: 'ləğv edildi', t: 7 },                                // closed unpaid
  { id: 'e', status: 'ləğv edildi', t: 9, courierDebt: 9 },                // taken back from the rider
  { id: 'f', status: 'gözləyir', t: 30 },                                  // still open
];

describe('Hesabat', () => {
  it('sums the sales, discounts and payment roads', () => {
    const r = historyReport(orders, total);
    expect(r).toEqual({
      count: 3, toplam: 42, endirim: 2, cemi: 40, nagd: 22, kart: 6, kuryer: 12,
      legv: { count: 1, sum: 7 }, qaytarma: { count: 1, sum: 9 },
    });
  });

  it('prints the same Nağd / Kart / Cəmi as the screen boxes', () => {
    const paidIds = new Set(['c']);
    const box = historyTotals(orders.map(o => o.id === 'c' ? { ...o, courierCash: 12 } : o), total, paidIds);
    const r = historyReport(orders.map(o => o.id === 'c' ? { ...o, courierCash: 12 } : o), total, paidIds);
    expect([r.nagd, r.kart, r.kuryer, r.cemi]).toEqual([box.nagd, box.kart, box.kuryer, box.cemi]);
    expect(r.nagd + r.kart + r.kuryer).toBeCloseTo(r.cemi);
  });

  it('prints every line, with Kuryer only when some money is out', () => {
    const head = { companyName: 'Chinar', from: '2026-10-20T05:00:00Z', to: '2026-10-20T19:40:00Z', printedBy: 'Natiq', timezone: 'Asia/Baku' };
    const text = historyReportLines(historyReport(orders, total), head).map(l => l.text).join('\n');
    for (const w of ['Hesabat 20.10.2026', 'Chinar', 'Natiq', 'Sifarişlərin sayı', 'Toplam', 'Endirimlər', 'CƏMİ', 'Nağd', 'Kart', 'Kuryer', 'Ləğv (1)', 'Qaytarma (1)']) {
      expect(text).toContain(w);
    }
    expect(text).toContain('09:00');
    const noCourier = historyReportLines(historyReport(orders.filter(o => o.id !== 'c'), total), head).map(l => l.text).join('\n');
    expect(noCourier).not.toContain('Kuryer');
  });

  it('the till prints it from Tarixçə with the shared function', () => {
    const seller = readFileSync('app/seller/page.tsx', 'utf8');
    expect(seller).toMatch(/historyReport\(historyOrders, orderTotal, historyPaidIds\)/);
  });
});

// Tarixçə's Məhsullar list: what each item sold in the day or shift in view.
// It must read the same as admin's Analiz for the same orders, and its total
// must be Tarixçə's Cəmi.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MenuItem, Order, OrderItem } from '@/types';
import { itemSales, itemSalesLines, shownSizes } from '@/lib/item-sales';
import { historyTotals } from '@/lib/history-shifts';
import { orderTotal } from '@/components/seller/order-format';
import { WIDTH } from '@/lib/escpos';

const line = (id: string, name: string, price: number, quantity: number, variantId?: string): OrderItem =>
  ({ menuItem: { id, name, price, category: 'Yemək', available: true }, quantity, variantId });
const order = (id: string, status: string, items: OrderItem[], extra: Partial<Order> = {}): Order =>
  ({ id, status, items, createdAt: '2026-10-31T10:00:00Z', ...extra }) as unknown as Order;

const menu: MenuItem[] = [
  { id: 'plov', name: 'Plov', price: 8, category: 'Yemək', available: true },
  { id: 'cay', name: 'Çay', price: 2, category: 'İçki', available: true,
    variants: [{ id: 'k', name: 'Kiçik', price: 2 }, { id: 'b', name: 'Böyük', price: 3 }] },
] as MenuItem[];

const orders: Order[] = [
  order('a', 'ödənilib', [line('plov', 'Plov', 8, 2), line('cay', 'Çay', 2, 1, 'k')], { cashAmount: 18 }),
  // 10% discount on 20 → each line pays 90%.
  order('b', 'ödənilib', [line('plov', 'Plov', 8, 1), line('cay', 'Çay', 3, 4, 'b')], { discountAmount: 2, cardAmount: 18 }),
  // Xidmət haqqı 10% → 0.80 on top, no dish's.
  order('c', 'ödənilib', [line('plov', 'Plov', 8, 1)], { serviceChargePercent: 10, cashAmount: 8.8 }),
  order('d', 'ləğv edildi', [line('plov', 'Plov', 8, 5)]),
  order('e', 'gözləyir', [line('cay', 'Çay', 2, 9, 'k')]),
];

describe('Məhsullar', () => {
  const r = itemSales(orders);

  it('counts paid orders only, most sold first', () => {
    expect(r.items.map(s => [s.name, s.qty])).toEqual([['Çay', 5], ['Plov', 4]]);
  });

  it('spreads the discount over the lines and keeps Xidmət haqqı apart', () => {
    const plov = r.items.find(s => s.id === 'plov')!;
    expect(plov.rev).toBeCloseTo(16 + 8 * 0.9 + 8);
    const cay = r.items.find(s => s.id === 'cay')!;
    expect(cay.rev).toBeCloseTo(2 + 12 * 0.9);
    expect(r.service).toBeCloseTo(0.8);
  });

  it('adds up to the Cəmi box in Tarixçə', () => {
    const box = historyTotals(orders, orderTotal);
    expect(r.total).toBeCloseTo(box.cemi);
    expect(r.items.reduce((s, i) => s + i.rev, 0) + r.service).toBeCloseTo(box.cemi);
  });

  it('lists sizes under an item that has them, by their menu names', () => {
    const cay = r.items.find(s => s.id === 'cay')!;
    expect(shownSizes(menu, cay).map(z => [z.name, z.qty])).toEqual([['Böyük', 4], ['Kiçik', 1]]);
    expect(shownSizes(menu, r.items.find(s => s.id === 'plov')!)).toEqual([]);
  });

  it('prints every item and the Cəmi, no line wider than the paper', () => {
    const long = itemSales([order('x', 'ödənilib', [line('l', 'Çox uzun adı olan bir yemək '.repeat(4), 5, 1)])]);
    for (const res of [r, long]) {
      const lines = itemSalesLines(res, menu, { companyName: 'Chinar', from: '2026-10-31T05:00:00Z', timezone: 'Asia/Baku', shift: 'Növbə 1' });
      for (const l of lines) expect(l.text.length).toBeLessThanOrEqual(WIDTH);
    }
    const text = itemSalesLines(r, menu, { companyName: 'Chinar', from: '2026-10-31T05:00:00Z', timezone: 'Asia/Baku' }).map(l => l.text).join('\n');
    expect(text).toMatch(/5 x Çay/);
    expect(text).toMatch(/4 x Plov/);
    expect(text).toMatch(/Xidmət haqqı/);
    expect(text).toMatch(new RegExp(`CƏMİ\\s+${r.total.toFixed(2)}m`));
  });

  it('Tarixçə and admin Analiz both count with lib/item-sales', () => {
    const admin = readFileSync('app/admin/page.tsx', 'utf8');
    const seller = readFileSync('app/seller/page.tsx', 'utf8');
    expect(admin).toMatch(/import \{[^}]*\bitemSales\b[^}]*\} from '@\/lib\/item-sales'/);
    expect(seller).toMatch(/import \{[^}]*\bitemSales\b[^}]*\} from '@\/lib\/item-sales'/);
    // Admin's own per-item tally must not come back.
    expect(admin).not.toMatch(/itemMap\[k\]\.qty \+=/);
    expect(admin).not.toMatch(/v\.qty \+= oi\.quantity/);
  });
});

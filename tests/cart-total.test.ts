// The till's cart, the QR menu's cart, the printed bill and the receipt each
// summed the dishes on their own; only the payment sheet used orderTotal.
// Since 2026-11-01 they all go through lib/service-charge (dishesTotal,
// cartToPay), so what the cart shows, what the bill prints and what the
// payment sheet asks for are the same qəpik.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MenuItem, Order } from '@/types';
import { cartToPay, dishesTotal, serviceAmount } from '@/lib/service-charge';
import { orderTotal } from '@/components/seller/order-format';
import { billLines } from '@/lib/printer';

const dish = (price: number): MenuItem => ({ id: String(price), name: 'x', price, category: 'c', available: true });
const line = (price: number, quantity: number) => ({ menuItem: dish(price), quantity });
const order = (items: ReturnType<typeof line>[], extra: Partial<Order> = {}): Order =>
  ({ id: 'o', orderNumber: 1, tableNumber: 1, status: 'yeni', createdAt: '', items, ...extra } as Order);

describe('the cart comes to what the bill and the payment sheet say', () => {
  const carts: [ReturnType<typeof line>[], number][] = [
    [[line(3.2, 2), line(0.6, 2)], 0],      // 7.6000000000000005 summed in floats
    [[line(3.2, 2), line(0.6, 2)], 10],
    [[line(1.15, 3), line(2.35, 1)], 12.5],
    [[line(0.1, 1), line(0.2, 1)], 0],
    [[line(4.99, 7)], 7],
  ];

  it.each(carts)('cart %j at %d%%', (items, percent) => {
    const dishes = dishesTotal(items);
    const cart = cartToPay(dishes, serviceAmount(dishes, percent));
    const o = order(items, { serviceChargePercent: percent || undefined });
    expect(cart).toBe(orderTotal(o));
    const bill = billLines(o, 'Kafe').map(l => l.text).find(t => t.startsWith('ÖDƏNİLƏCƏK'))!;
    expect(bill).toContain(orderTotal(o).toFixed(2));
  });

  it('is to the qəpik, not 7.6000000000000005', () => {
    expect(dishesTotal([line(3.2, 2), line(0.6, 2)])).toBe(7.6);
    expect(cartToPay(0.1, 0.2)).toBe(0.3);
  });

  it('a fully discounted bill says 0.00, not -0.00', () => {
    // İXLAS CAFE #1711: 1.20 + 0.60 summed to 1.7999999999999998, less 1.80
    const o = order([line(1.2, 1), line(0.6, 1)], { discountAmount: 1.8 });
    const bill = billLines(o, 'Kafe').map(l => l.text).find(t => t.startsWith('ÖDƏNİLƏCƏK'))!;
    expect(bill).toContain('0.00');
    expect(bill).not.toContain('-0.00');
  });

  it('the bill asks for the discounted total', () => {
    const o = order([line(10, 2)], { serviceChargePercent: 10, discountAmount: 2 });
    expect(orderTotal(o)).toBe(20);
    expect(billLines(o, 'Kafe').map(l => l.text).find(t => t.startsWith('ÖDƏNİLƏCƏK'))).toContain('20.00');
  });
});

describe('no cart or paper sums the dishes on its own', () => {
  it('uses dishesTotal / orderTotal', () => {
    for (const f of ['app/seller/page.tsx', 'app/[slug]/menu/page.tsx', 'components/seller/CartItems.tsx', 'lib/printer.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/reduce\(\(s, \w+\) => s \+ \w+\.menuItem\.price \* /);
      expect(src, f).toMatch(/dishesTotal\(/);
    }
  });
});

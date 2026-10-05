// Statistika's "Satış tipləri" (Test Restoran, 2026-10-05): sales by masa,
// takeaway, delivery and online. The rows must add up to Gəlir and sort an
// order the same way the admin's Sifarişlər filter does.

import { describe, expect, it } from 'vitest';
import type { Order } from '@/types';
import { placeSales } from '@/lib/place-sales';
import { orderPlaceKind } from '@/lib/order-place';

const o = (total: number, extra: Partial<Order> = {}) => ({ tableNumber: 0, total, ...extra }) as unknown as Order;
const total = (x: Order) => (x as unknown as { total: number }).total;

const orders = [
  o(10, { tableNumber: 3 }), o(5, { tableNumber: 1 }),
  o(4),
  o(8, { courierId: 'k1' }),
  o(6, { online: true }), o(2, { online: true, courierId: 'k1' }),
];

describe('placeSales', () => {
  it('splits sales by order type, in a fixed order, with counts', () => {
    expect(placeSales(orders, true, total).map(r => [r.label, r.rev, r.count])).toEqual([
      ['Masa', 15, 2], ['Takeaway', 4, 1], ['Çatdırılma', 8, 1], ['Onlayn', 8, 2],
    ]);
  });

  it('adds up to the total revenue', () => {
    const sum = placeSales(orders, true, total).reduce((s, r) => s + r.rev, 0);
    expect(sum).toBe(orders.reduce((s, x) => s + total(x), 0));
  });

  it('agrees with the Sifarişlər filter for every order', () => {
    for (const x of orders) {
      const row = placeSales([x], true, total)[0];
      expect(row.kind).toBe(orderPlaceKind(x, { deliveryOn: true }));
    }
  });

  it('leaves out kinds with no orders', () => {
    expect(placeSales([o(3, { tableNumber: 2 })], true, total).map(r => r.kind)).toEqual(['masa']);
  });
});

describe('tableSales (the Masa row opened)', () => {
  const tables = [{ id: 51, name: '1' }, { id: 52, name: 'Terras 3' }];

  it('one row per table, by its real name, highest first, adding up to Masa', async () => {
    const { tableSales } = await import('@/lib/place-sales');
    const rows = tableSales([
      o(5, { tableNumber: 51 }), o(20, { tableNumber: 52 }), o(7, { tableNumber: 51 }), o(9),
    ], tables, total);
    expect(rows).toEqual([
      { name: 'Terras 3', rev: 20, count: 1 },
      { name: 'Masa 1', rev: 12, count: 2 },
    ]);
  });

  it('a deleted table still shows, by its number', async () => {
    const { tableSales } = await import('@/lib/place-sales');
    expect(tableSales([o(4, { tableNumber: 9 })], tables, total)).toEqual([{ name: 'Masa 9', rev: 4, count: 1 }]);
  });
});

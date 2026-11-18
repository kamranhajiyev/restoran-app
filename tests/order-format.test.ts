// The till's total, moved out of app/seller/page.tsx with the order card.
// A bill of 3.20×2 + 0.60×2 summed to 7.6000000000000005 and could not be paid
// at its own total (LESSONS.md, Money).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { orderTotal, round2, tableAmount, tableTotal } from '@/components/seller/order-format';
import type { Order } from '@/types';

const line = (price: number, quantity: number) =>
  ({ menuItem: { price }, quantity }) as unknown as Order['items'][number];

describe('order total', () => {
  it('comes out to the cent', () => {
    const order = { items: [line(3.2, 2), line(0.6, 2)] } as Order;
    expect(orderTotal(order)).toBe(7.6);
  });

  it('takes the discount off', () => {
    const order = { items: [line(5, 2)], discountAmount: 1.5 } as Order;
    expect(orderTotal(order)).toBe(8.5);
  });

  it('rounds to 0.01', () => {
    expect(round2(6.4 + 1.2)).toBe(7.6);
  });
});

// The floor plan showed a 12.60 table as "13 ₼" while the bill said 12.60.
describe('table amount', () => {
  it('keeps kopeks', () => {
    expect(tableAmount(12.6)).toBe('12.60 ₼');
    expect(tableAmount(12.4)).toBe('12.40 ₼');
    expect(tableAmount(3.2 * 2 + 0.6 * 2)).toBe('7.60 ₼');
  });

  it('drops .00 on a whole amount', () => {
    expect(tableAmount(12)).toBe('12 ₼');
  });

  it('sums only the open orders on that table', () => {
    const orders = [
      { tableNumber: 4, status: 'gözləyir', items: [line(5.3, 1)] },
      { tableNumber: 4, status: 'hazırdır', items: [line(2.2, 1)] },
      { tableNumber: 4, status: 'ödənilib', items: [line(100, 1)] },
      { tableNumber: 5, status: 'gözləyir', items: [line(9, 1)] },
    ] as Order[];
    expect(tableTotal(orders, 4)).toBe(7.5);
  });

  it('is what the seller floor plan shows', () => {
    const src = readFileSync('app/seller/page.tsx', 'utf8');
    expect(src).toContain('tableAmount(busyTotal)');
    expect(src).not.toMatch(/busyTotal\.toFixed\(0\)/);
  });
});

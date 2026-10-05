// The till's total, moved out of app/seller/page.tsx with the order card.
// A bill of 3.20×2 + 0.60×2 summed to 7.6000000000000005 and could not be paid
// at its own total (LESSONS.md, Money).

import { describe, expect, it } from 'vitest';
import { orderTotal, round2 } from '@/components/seller/order-format';
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

// The Kassa's "Ümumi satış" left out what riders still hold, so a shift with
// 30 ₼ on a courier read 30 short of Tarixçə (Latte Art, 2026-10-05). The
// figure the site and the browser terminal use; the exe's is in exe-till.test.ts.

import { describe, expect, it } from 'vitest';
import { courierStillOut } from '@/lib/courier-pending';

describe("the courier's share of a shift", () => {
  it('is what each delivery still owes', () => {
    expect(courierStillOut([
      { courier_debt: 30, courier_cash: 0, courier_card: 0 },
      { courier_debt: '12.50', courier_cash: '10', courier_card: null },
      { courier_debt: null },
    ])).toBe(32.5);
  });

  it('drops to nothing once the rider has paid, so the total does not count it twice', () => {
    expect(courierStillOut([{ courier_debt: 30, courier_cash: 20, courier_card: 10 }])).toBe(0);
  });

  it('never goes below zero on an overpayment', () => {
    expect(courierStillOut([{ courier_debt: 10, courier_cash: 15 }])).toBe(0);
  });
});

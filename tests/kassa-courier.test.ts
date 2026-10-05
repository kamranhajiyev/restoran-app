// The Kassa's "Ümumi satış" left out what riders still hold, so a shift with
// 30 ₼ on a courier read 30 short of Tarixçə (Latte Art, 2026-10-05). The
// figure the site and the browser terminal use; the exe's is in exe-till.test.ts.

import { describe, expect, it } from 'vitest';
import { courierStillOut, kassaSales } from '@/lib/courier-pending';

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

// Latte Art, 2026-10-05: a 10 ₼ delivery closed on a rider in shift 1 was in
// shift 1's sales, and again in shift 2's once the rider paid it back there.
describe("the Kassa's sales box", () => {
  it('counts a delivery in the shift that sold it, paid back or not', () => {
    const shift1 = kassaSales({ cash: 20, card: 5, courierCard: 0, courierSales: 10, courier: 10 }, 0);
    expect(shift1).toMatchObject({ nagd: 20, kart: 5, kuryer: 10, kuryerOut: 10, total: 35 });
  });

  it('does not count it again in the next shift when the rider pays it back in cash', () => {
    // Shift 2 sold 8 ₼ in cash; the rider brought shift 1's 10 ₼.
    const shift2 = kassaSales({ cash: 8, card: 0, courierCard: 0, courierSales: 0, courier: 0 }, 10);
    expect(shift2.total).toBe(8);
  });

  it('nor when he pays it back by card', () => {
    // The terminal saw 3 ₼ of sales and the rider's 10 ₼.
    const shift2 = kassaSales({ cash: 0, card: 13, courierCard: 10, courierSales: 0, courier: 0 }, 0);
    expect(shift2).toMatchObject({ kart: 3, total: 3 });
  });

  it("keeps an older exe's answer as it was", () => {
    expect(kassaSales({ cash: 8, card: 0 }, 10).total).toBe(18);
  });
});

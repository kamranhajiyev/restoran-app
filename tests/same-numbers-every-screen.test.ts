// The same number must read the same on every screen (Latte Art, 2026-10-06).
// Tarixçə counted a shift by its orders; admin's closed shifts worked it out
// from the drawer money, which holds courier payments for older shifts, so
// admin showed different sales for the same shift.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { shiftTotals, type HistoryShift } from '@/lib/history-shifts';

type O = { id: string; status: 'ödənilib'; createdAt: string; paidAt?: string; t: number;
  cashAmount?: number; cardAmount?: number; courierDebt?: number; courierCash?: number; courierCard?: number };
const total = (o: O) => o.t;

const shift2: HistoryShift = { id: 's2', openedAt: '2026-10-05T14:00:00Z', openedBy: 'x', closedAt: '2026-10-05T20:00:00Z' };

describe('a closed shift reads the same in admin and Tarixçə', () => {
  it('Növbə 2: 13 nağd, 0.20 kart, 10 kuryer = 23.20', () => {
    const orders: O[] = [
      { id: 'a', status: 'ödənilib', createdAt: '2026-10-05T15:00:00Z', paidAt: '2026-10-05T15:10:00Z', t: 13, cashAmount: 13 },
      { id: 'b', status: 'ödənilib', createdAt: '2026-10-05T16:00:00Z', paidAt: '2026-10-05T16:05:00Z', t: 0.2, cardAmount: 0.2 },
      // Delivered in this shift, the rider paid it back in the next one.
      { id: 'c', status: 'ödənilib', createdAt: '2026-10-05T17:00:00Z', paidAt: '2026-10-05T17:00:00Z', t: 10, courierDebt: 10, courierCash: 10 },
      // An older shift's order, paid there: not this shift's sale.
      { id: 'd', status: 'ödənilib', createdAt: '2026-10-05T09:00:00Z', paidAt: '2026-10-05T09:30:00Z', t: 5, cashAmount: 5 },
    ];
    const r = shiftTotals(orders, shift2, '2026-10-06T10:00:00Z', total, new Set(['older-courier-order']));
    expect(r.nagd).toBeCloseTo(13);
    expect(r.kart).toBeCloseTo(0.2);
    expect(r.kuryer).toBeCloseTo(10);
    expect(r.cemi).toBeCloseTo(23.2);
  });

  it('admin and the till both count shifts with lib/history-shifts', () => {
    const admin = readFileSync('app/admin/page.tsx', 'utf8');
    const seller = readFileSync('app/seller/page.tsx', 'utf8');
    expect(admin).toMatch(/import \{[^}]*\bshiftTotals\b[^}]*\} from '@\/lib\/history-shifts'/);
    expect(seller).toMatch(/import \{[^}]*\bhistoryTotals\b[^}]*\} from '@\/lib\/history-shifts'/);
    // The old drawer-money formula must not come back.
    expect(admin).not.toMatch(/expectedCash - s\.openingCash - movTotal\(s\) \+ courierCash/);
  });
});

// Test Restoran, 2026-10-06: Növbə 3's 28 ₼ delivery (№99940) was paid back in
// cash inside the shift. Tarixçə read Nağd 44.50 / Kart 10.20, but the open
// shift's Kassa — seller and admin — still read Nağd 16.50 / Kuryer 28: it was
// counted by kassaSales from the drawer money, not by Tarixçə's function.
describe('an open shift reads the same in Kassa and Tarixçə', () => {
  const shift3: HistoryShift = { id: 's3', openedAt: '2026-10-06T06:52:00Z', openedBy: 'Elnur' };
  const at = (h: string) => `2026-10-06T${h}:00Z`;
  const orders: O[] = [
    { id: '99939', status: 'ödənilib', createdAt: at('06:58'), paidAt: at('06:58'), t: 10, cashAmount: 10 },
    { id: '99940', status: 'ödənilib', createdAt: at('07:05'), paidAt: at('07:05'), t: 28, courierDebt: 28, courierCash: 28 },
    { id: '99941', status: 'ödənilib', createdAt: at('16:39'), paidAt: at('16:40'), t: 2, cashAmount: 2 },
    { id: '99942', status: 'ödənilib', createdAt: at('16:39'), paidAt: at('16:40'), t: 2, cashAmount: 2 },
    { id: '99943', status: 'ödənilib', createdAt: at('16:40'), paidAt: at('16:41'), t: 10.2, cardAmount: 10.2 },
    { id: '99944', status: 'ödənilib', createdAt: at('17:07'), paidAt: at('17:07'), t: 2.5, cashAmount: 2.5 },
    // Növbə 2's delivery, paid back (5 nağd + 5 kart) in Növbə 3: drawer and
    // terminal money, not Növbə 3's sale.
    { id: '99937', status: 'ödənilib', createdAt: at('06:46'), paidAt: at('06:47'), t: 10, courierDebt: 10, courierCash: 5, courierCard: 5 },
  ];

  it('the paid-back delivery is Nağd, not Kuryer', () => {
    const r = shiftTotals(orders, shift3, at('19:30'), total, new Set(['99937', '99940']));
    expect(r.nagd).toBeCloseTo(44.5);
    expect(r.kart).toBeCloseTo(10.2);
    expect(r.kuryer).toBeCloseTo(0);
    expect(r.cemi).toBeCloseTo(54.7);
  });

  it('a delivery not yet paid back stays under Kuryer', () => {
    const r = shiftTotals(orders, shift3, at('19:30'), total, new Set(['99937']));
    expect(r.nagd).toBeCloseTo(16.5);
    expect(r.kuryer).toBeCloseTo(28);
    expect(r.cemi).toBeCloseTo(54.7);
  });

  it("no screen counts sales with its own formula", () => {
    const admin = readFileSync('app/admin/page.tsx', 'utf8');
    const seller = readFileSync('app/seller/page.tsx', 'utf8');
    const lib = readFileSync('lib/courier-pending.ts', 'utf8');
    // Seller Kassa counts the open shift like Tarixçə.
    expect(seller).toMatch(/setKassaTotals\(shiftTotals\(/);
    // Admin's open shift is loaded by the same loader as the closed ones.
    expect(admin).toMatch(/if \(open\) \{ void loadShiftTotals\(open\)/);
    // Statistika's Ödəniş üsulları too.
    expect(admin).toMatch(/const payTotals = historyTotals\(chartPaid, orderTotal/);
    expect(admin).not.toMatch(/methodRev/);
    // The drawer-money sales formula is gone for good.
    expect(lib + admin + seller).not.toMatch(/kassaSales/);
  });
});

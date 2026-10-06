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

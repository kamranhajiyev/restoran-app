// A shift's Nağd / Kart / Kuryer were summed in three places: the website
// (lib/store fetchShiftSales), the till's route (/api/public-shift-sales) and
// the exe/phone's own database (lib/till-store getShiftSales, in SQL). Since
// 2026-11-01 all three hand their rows to lib/shift-sales.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { shiftSales } from '@/lib/shift-sales';

describe('shift sales', () => {
  it('cash in the drawer, card on the terminal, couriers apart', () => {
    const paid = [
      { cash_amount: 10, card_amount: 0 },
      { cash_amount: 5, card_amount: 7.5 },              // split
      { cash_amount: 0, card_amount: 0, courier_debt: 20 },                   // rider still holds 20
      { cash_amount: 0, card_amount: 0, courier_debt: 12, courier_cash: 12 }, // rider paid back
      { cash_amount: 0, card_amount: 0, courier_debt: 8, courier_cash: 3, courier_card: 2 }, // 3 still out
    ];
    // Riders' card settlements land on the terminal, maybe for an older delivery.
    expect(shiftSales(paid, [{ amount: 2 }, { amount: 4 }])).toEqual({
      cash: 15, card: 7.5 + 6, courierCard: 6, courierSales: 40, courier: 23,
    });
  });

  it('a rider who paid more than he owed holds nothing, not minus', () => {
    expect(shiftSales([{ courier_debt: 10, courier_cash: 15 }], []).courier).toBe(0);
  });

  it('reads the database’s text and nulls as amounts', () => {
    expect(shiftSales([{ cash_amount: '4.50', card_amount: null }], [{ amount: '1.20' }]))
      .toEqual({ cash: 4.5, card: 1.2, courierCard: 1.2, courierSales: 0, courier: 0 });
  });

  it('is to the qəpik, not 0.30000000000000004', () => {
    const s = shiftSales([{ cash_amount: 0.1, card_amount: 0.1 }, { cash_amount: 0.2, card_amount: 0.2 }], []);
    expect(s.cash).toBe(0.3);
    expect(s.card).toBe(0.3);
  });

  it('nothing sold reads zeros', () => {
    expect(shiftSales([], [])).toEqual({ cash: 0, card: 0, courierCard: 0, courierSales: 0, courier: 0 });
  });
});

describe('no place sums the shift on its own', () => {
  it('the website, the till route and the exe all call lib/shift-sales', () => {
    for (const f of ['lib/store.ts', 'app/api/public-shift-sales/route.ts', 'lib/till-store/repo.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).toMatch(/return (Response\.json\()?shiftSales\(/);
      expect(src, f).not.toMatch(/s \+ Number\(o\.(cash|card)_amount/);
      expect(src, f).not.toMatch(/sum\(cash_amount\)/);
    }
  });

  it('lib/shift-sales stays importable by the exe (no @/ paths)', () => {
    for (const f of ['lib/shift-sales.ts', 'lib/courier-pending.ts']) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/from '@\//);
    }
  });
});

// Latte Art, 2026-10-07: cash 9 = 9, terminal 0.40 against 1.40 card. The
// closed-shift list said "Dəqiq ✓" because it only checked cash.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { moneyDiff, shiftCheck } from '@/lib/shift-check';

describe('a closed shift is "Dəqiq" only when cash and card both match', () => {
  it('cash right, terminal 1 ₼ short: not Dəqiq', () => {
    const r = shiftCheck({ expectedCash: 9, countedCash: 9, cardSales: 1.4, countedCard: 0.4 });
    expect(r.state).toBe('short');
    expect(r.label).toBe('Kart -1.00 ₼');
  });

  it('both right: Dəqiq', () => {
    expect(shiftCheck({ expectedCash: 9, countedCash: 9, cardSales: 1.4, countedCard: 1.4 }))
      .toEqual({ state: 'exact', label: 'Dəqiq ✓' });
  });

  it('terminal not entered: only cash is checked', () => {
    expect(shiftCheck({ expectedCash: 9, countedCash: 9, cardSales: 1.4 }).label).toBe('Dəqiq ✓');
    expect(shiftCheck({ expectedCash: 9, countedCash: 8, cardSales: 1.4 }).label).toBe('-1.00 ₼');
  });

  it('both off: both shown, short wins the colour', () => {
    const r = shiftCheck({ expectedCash: 9, countedCash: 10, cardSales: 2, countedCard: 1.5 });
    expect(r.state).toBe('short');
    expect(r.label).toBe('Nağd +1.00 ₼ · Kart -0.50 ₼');
  });

  it('rounds to the qəpik before comparing', () => {
    expect(moneyDiff(6.4 + 1.2, 7.6).state).toBe('exact');
  });

  it('admin and the till check money with lib/shift-check', () => {
    const admin = readFileSync('app/admin/page.tsx', 'utf8');
    const seller = readFileSync('app/seller/page.tsx', 'utf8');
    expect(admin).toMatch(/import \{[^}]*\bshiftCheck\b[^}]*\} from '@\/lib\/shift-check'/);
    expect(seller).toMatch(/import \{[^}]*\bmoneyDiff\b[^}]*\} from '@\/lib\/shift-check'/);
    // The cash-only badge must not come back.
    expect(admin).not.toMatch(/const diff = \(s\.countedCash \?\? 0\) - \(s\.expectedCash \?\? 0\)/);
    expect(seller).not.toMatch(/\? 'Dəqiq ✓'/);
  });
});

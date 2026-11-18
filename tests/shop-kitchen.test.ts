// A shop has no kitchen: no "Mətbəxə çap et" toggle and no kitchen ticket,
// not for a delivery either. A restaurant keeps both (the user, 2026-11-17).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { printsKitchen } from '@/lib/shop-mode';

const seller = readFileSync('app/seller/page.tsx', 'utf8');

describe('kitchen printing on the till', () => {
  it('is off in a shop and on in a restaurant', () => {
    expect(printsKitchen('shop')).toBe(false);
    expect(printsKitchen('restaurant')).toBe(true);
  });

  it('every toggle asks the shop rule first', () => {
    const toggles = seller.match(/\{[^{}]*<PrintKitchenToggle /g) ?? [];
    expect(toggles.length).toBe(2);
    for (const t of toggles) expect(t).toContain('printsKitchen(kind) &&');
  });

  it('every kitchen decision goes through toKitchen, never the bare toggle', () => {
    expect(seller).toMatch(/const toKitchen = printKitchen && printsKitchen\(kind\);/);
    const rest = seller.replace('const toKitchen = printKitchen && printsKitchen(kind);', '');
    expect(rest).not.toMatch(/\bprintKitchen \?|\bprintKitchen &&/);
  });
});

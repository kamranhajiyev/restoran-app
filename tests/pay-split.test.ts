// Nağd and Kart fill each other, whichever is typed first (Latte Art,
// 2026-10-06): clicking Kart first and typing 0.20 left Nağd empty and the
// sheet said "Çatışmır 8.00".

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { otherPart } from '@/lib/pay-split';

describe('payment sheet split', () => {
  it('Nağd first: 8 cash leaves 0.20 for Kart', () => {
    expect(otherPart('8', 8.2)).toBe('0.20');
  });

  it('Kart first: 0.20 card leaves 8.00 for Nağd', () => {
    expect(otherPart('0.2', 8.2)).toBe('8.00');
  });

  it('the whole bill, more, or nothing in one box leaves the other empty', () => {
    expect(otherPart('8.20', 8.2)).toBe('');
    expect(otherPart('10', 8.2)).toBe('');
    expect(otherPart('', 8.2)).toBe('');
  });

  it('both boxes on the sheet follow each other', () => {
    const seller = readFileSync('app/seller/page.tsx', 'utf8');
    expect(seller).toMatch(/setCardInput\(e\.target\.value\);[^}]*followCash\(/);
    expect(seller).toMatch(/setCashInput\(e\.target\.value\);[^}]*followCard\(/);
  });
});

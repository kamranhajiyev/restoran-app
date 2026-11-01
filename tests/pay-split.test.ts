// Nağd and Kart fill each other, whichever is typed first (Latte Art,
// 2026-10-06): clicking Kart first and typing 0.20 left Nağd empty and the
// sheet said "Çatışmır 8.00".

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cardOverBill, otherPart } from '@/lib/pay-split';

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

  // İXLAS CAFE, October 2026: three 6.00 bills saved as 6.01 card, so Kart in
  // Statistika and Kassa was over by a qəpik each time.
  it('Kart above the bill is refused; cash above it is change', () => {
    expect(cardOverBill(6.01, 6)).toBe(true);
    expect(cardOverBill(6, 6)).toBe(false);
    expect(cardOverBill(2, 6)).toBe(false);
    expect(cardOverBill(0.1 + 0.2, 0.3)).toBe(false); // float dust is not more
  });

  it('the sheet will not close with too much on Kart', () => {
    const seller = readFileSync('app/seller/page.tsx', 'utf8');
    expect(seller).toMatch(/const canPay = onDebt \? total > 0 : paid >= total && !cardTooMuch;/);
    expect(seller).toMatch(/if \(cardOverBill\(card, total\)\) return;/);
  });

  it('both boxes on the sheet follow each other', () => {
    const seller = readFileSync('app/seller/page.tsx', 'utf8');
    expect(seller).toMatch(/setCardInput\(e\.target\.value\);[^}]*followCash\(/);
    expect(seller).toMatch(/setCashInput\(e\.target\.value\);[^}]*followCard\(/);
  });
});

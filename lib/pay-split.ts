// Nağd and Kart on the payment sheet fill each other.
//
// Latte Art, 2026-10-06: Kart filled itself when Nağd was typed, but not the
// other way. Clicking Kart moves the whole bill there; typing 0.20 then left
// Nağd empty and the sheet said "Çatışmır 8.00". Both boxes use this one rule.

import { round2 } from '@/components/seller/order-format';

/** What the other box should hold once one box says `typed`. */
export function otherPart(typed: string, billTotal: number): string {
  const t = round2(parseFloat(typed) || 0);
  // Nothing typed, or the whole bill (or more — change is due) in one box.
  return t > 0 && t < billTotal ? round2(billTotal - t).toFixed(2) : '';
}

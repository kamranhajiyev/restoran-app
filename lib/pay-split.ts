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

/**
 * Kart above the bill. Extra cash comes back as change, but a card gives no
 * change, so the extra was booked as card income. İXLAS CAFE, October 2026:
 * three 6.00 bills paid 6.01 by card, and Kart was over by a qəpik each time.
 */
export function cardOverBill(card: number, billTotal: number): boolean {
  return round2(card) > round2(billTotal);
}

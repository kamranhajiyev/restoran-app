// What a cash shift's drawer should hold, and its Mədaxil / Məxaric. The till
// and admin's Kassa both close shifts and both show these, so they are counted
// here once.

import type { CashShift } from '@/types';
import { round2 } from '@/components/seller/order-format';

type Moves = Pick<CashShift, 'movements'>;

/** Every Mədaxil less every Məxaric. */
export function movementsTotal(s: Moves): number {
  return s.movements.reduce((t, m) => t + m.amount, 0);
}

export function movementsIn(s: Moves): number {
  return s.movements.filter(m => m.amount > 0).reduce((t, m) => t + m.amount, 0);
}

/** Negative: the money taken out. */
export function movementsOut(s: Moves): number {
  return s.movements.filter(m => m.amount < 0).reduce((t, m) => t + m.amount, 0);
}

/** "Kassada olmalıdır": the opening cash, the shift's cash sales, and the
 *  movements. Card money never goes in the drawer. Rounded to the qəpik: the
 *  sum is of floats, and İXLAS CAFE's shifts were saved as 0.09999999999999432
 *  instead of 0.10 (2026-11-01). */
export function expectedCash(s: Pick<CashShift, 'openingCash' | 'movements'>, cashSales: number): number {
  return round2(s.openingCash + cashSales + movementsTotal(s));
}

/** The card sales a closing shift saves, to the qəpik: İXLAS CAFE's were saved
 *  as 215.79999999999995 (2026-11-01). */
export function cardSalesToSave(card: number): number {
  return round2(card);
}

/** Admin's payment edit: may cash + card stand on an order of `total`? Summed
 *  to the qəpik first, or 6.40 + 1.20 on a 7.60 order reads as too much. */
export function paymentTooMuch(cash: number, card: number, total: number): boolean {
  return round2(cash + card) > round2(total);
}

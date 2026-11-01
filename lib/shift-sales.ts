// A shift's takings, one rule for the website (lib/store fetchShiftSales), the
// till's route (/api/public-shift-sales) and the exe/phone's own database
// (lib/till-store getShiftSales). Until 2026-11-01 each summed on its own.
// Relative imports only: lib/till-store is built into the exe without '@/'.

import { courierSold, courierStillOut, type ShiftSales } from './courier-pending';

type Money = number | string | null | undefined;

/** A paid order since the shift opened. */
export type ShiftSaleRow = {
  cash_amount?: Money; card_amount?: Money;
  courier_debt?: Money; courier_cash?: Money; courier_card?: Money;
};

const sum = <T>(rows: T[], amount: (r: T) => Money) => rows.reduce((s, r) => s + Number(amount(r) ?? 0), 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** paid — orders paid since the shift opened; courierCardPayments — riders'
 *  settlements by card since then, which land on the bank terminal. */
export function shiftSales(paid: ShiftSaleRow[], courierCardPayments: { amount?: Money }[]): ShiftSales {
  const settledByCard = sum(courierCardPayments, p => p.amount);
  return {
    cash: r2(sum(paid, o => o.cash_amount)),
    card: r2(sum(paid, o => o.card_amount) + settledByCard),
    courierCard: r2(settledByCard),
    courierSales: courierSold(paid),
    courier: courierStillOut(paid),
  };
}

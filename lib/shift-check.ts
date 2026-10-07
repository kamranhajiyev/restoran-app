// Did a shift's money come out right?
//
// Latte Art, 2026-10-07: cash matched (9 = 9) but the terminal's Z-report was
// 1 ₼ short on card (0.40 against 1.40). The closed-shift list checked only
// cash and said "Dəqiq ✓", so the shortfall showed only after opening the row.

export type MoneyState = 'exact' | 'short' | 'over';

/** Counted against what it should be, rounded to the qəpik. */
export function moneyDiff(counted: number, expected: number): { diff: number; state: MoneyState } {
  const diff = Math.round((counted - expected) * 100) / 100;
  return { diff, state: diff === 0 ? 'exact' : diff < 0 ? 'short' : 'over' };
}

const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2)} ₼`;

/**
 * One verdict for a closed shift: "Dəqiq ✓" only when the cash and the
 * terminal both match. The terminal is checked only when it was entered.
 */
export function shiftCheck(s: {
  expectedCash?: number; countedCash?: number; cardSales?: number; countedCard?: number;
}): { state: MoneyState; label: string } {
  const cash = moneyDiff(s.countedCash ?? 0, s.expectedCash ?? 0);
  const card = s.countedCard === undefined ? undefined : moneyDiff(s.countedCard, s.cardSales ?? 0);

  const parts: string[] = [];
  if (cash.state !== 'exact') parts.push(card && card.state !== 'exact' ? `Nağd ${signed(cash.diff)}` : signed(cash.diff));
  if (card && card.state !== 'exact') parts.push(`Kart ${signed(card.diff)}`);

  const state: MoneyState =
    cash.state === 'short' || card?.state === 'short' ? 'short'
    : cash.state === 'over' || card?.state === 'over' ? 'over'
    : 'exact';
  return { state, label: parts.length ? parts.join(' · ') : 'Dəqiq ✓' };
}

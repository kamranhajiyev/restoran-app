// Az qalan mal (SHOP-MODE.md, step 6). The owner gives a product a limit in
// Anbar ("5-dən az olsa xəbər ver"); below it, Anbar shows a red count and the
// item at the top, and the till's product card says "3 qalıb". A sale is never
// blocked — this only warns. Counted on the stock across every warehouse.

export interface StockLimit { stockItemId: string; minQty: number }
export interface LowItem { stockItemId: string; qty: number; minQty: number }
/** How products reach their stock rows (recipe_lines of a Məhsul). */
export interface StockLink { menuItemId: string; variantId: string | null; stockItemId: string }

/** The total of each stock item over all its warehouse rows. */
export function stockTotals(balances: { stockItemId: string; qty: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of balances) out.set(b.stockItemId, Math.round(((out.get(b.stockItemId) ?? 0) + Number(b.qty)) * 1000) / 1000);
  return out;
}

/** Items with a limit whose stock is below it. No limit (null, 0) = no warning. */
export function lowStock(limits: StockLimit[], balances: { stockItemId: string; qty: number }[]): LowItem[] {
  const totals = stockTotals(balances);
  return limits
    .filter(l => l.minQty > 0)
    .map(l => ({ stockItemId: l.stockItemId, qty: totals.get(l.stockItemId) ?? 0, minQty: l.minQty }))
    .filter(l => l.qty < l.minQty);
}

/** The key a till card looks itself up by: the product, or the product and size. */
export const lowKey = (menuItemId: string, variantId?: string | null) => variantId ? `${menuItemId}:${variantId}` : menuItemId;

/** What the till needs: for each low product (or size), how many are left. */
export function lowForTill(low: LowItem[], links: StockLink[]): Record<string, number> {
  const byItem = new Map(low.map(l => [l.stockItemId, l.qty]));
  const out: Record<string, number> = {};
  for (const link of links) {
    const qty = byItem.get(link.stockItemId);
    if (qty !== undefined) out[lowKey(link.menuItemId, link.variantId)] = qty;
  }
  return out;
}

/** "3 qalıb" — none left reads "Bitib". */
export function leftLabel(qty: number): string {
  return qty <= 0 ? 'Bitib' : `${Number(qty.toFixed(3))} qalıb`;
}

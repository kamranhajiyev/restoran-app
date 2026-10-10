// A dish's recipe: how much of each warehouse item one portion takes. Edited in
// the menu form (admin → Menyu → Düzəlt), taken off the stock by the database
// when the order is paid.

import type { RecipeIngredient } from '@/types';

/** What the form holds, as it is saved: no empty row, no amount of zero, and an
 *  ingredient listed twice counted once with both amounts. */
export function cleanRecipe(rows: { stockItemId: string; qty: string | number }[]): RecipeIngredient[] {
  const out: RecipeIngredient[] = [];
  for (const r of rows) {
    const qty = typeof r.qty === 'number' ? r.qty : parseFloat(r.qty.replace(',', '.'));
    if (!r.stockItemId || !(qty > 0)) continue;
    const same = out.find(x => x.stockItemId === r.stockItemId);
    if (same) same.qty += qty; else out.push({ stockItemId: r.stockItemId, qty });
  }
  return out;
}

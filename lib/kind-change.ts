// Changing Növ moves stock. A Məhsul takes itself from Anbar, 1 per sale, from
// a row of its own; a Yemək takes its recipe. Natiq, 2026-10-16: Dolma went
// Məhsul → Yemək and its row stayed in Anbar. The database now lets go of the
// row (20261026_product_stops_being_product.sql); these are the admin's rules
// for what to ask before the save.

import type { ItemKind } from './set-items';

/** What a Növ change does to stock:
 *  - 'release': a Məhsul stops being one; its own row is let go, and one with
 *    stock or history needs the owner's answer;
 *  - 'drop-recipe': a Yemək becomes a Məhsul; its recipe is deleted;
 *  - 'none': nothing stock-wise (a new item, or no change). */
export function kindChangeStock(from: ItemKind | null, to: ItemKind): 'release' | 'drop-recipe' | 'none' {
  if (from === null || from === to) return 'none';
  if (from === 'product') return 'release';
  if (from === 'meal' && to === 'product') return 'drop-recipe';
  return 'none';
}

/** The recipe the form shows for an item. A Məhsul's lines are its own rows,
 *  not a recipe: shown under Yemək they would be saved as "1 × Dolma", and the
 *  dish would go on taking itself. */
export function formRecipeLines<T>(kind: ItemKind, lines: T[]): T[] {
  return kind === 'product' ? [] : lines;
}

export interface LeftStock { stockItemId: string; name: string; unit: string; qty: number }

/** "Anbarda 12 ədəd Dolma qalıb." One sentence per row left behind. */
export function leftStockMessage(left: LeftStock[]): string {
  const lines = left.map(l => l.qty !== 0
    ? `Anbarda ${fmtQty(l.qty)} ${l.unit} ${l.name} qalıb.`
    : `${l.name} anbarda keçmiş hərəkətləri olan sətirdir.`);
  return `${lines.join(' ')} Silinsin, yoxsa inqrediyent kimi qalsın?`;
}

/** The warning before a Yemək becomes a Məhsul. Null rows: the recipe did not
 *  load, so the count is unknown and the warning says so. */
export function recipeLostMessage(rows: number | null): string {
  if (rows === null) return 'Məhsulun resepti olmur: bu yeməyin resepti varsa, silinəcək. Davam edilsin?';
  return `Məhsulun resepti olmur: bu yeməyin reseptindəki ${rows} inqrediyent silinəcək. Davam edilsin?`;
}

function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

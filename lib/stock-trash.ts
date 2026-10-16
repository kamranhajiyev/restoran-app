// Deleting an inqrediyent in Anbar. Natiq, 2026-10-16: a real delete took the
// history with it (a receipt keeps its total, so it stopped adding up), so a
// used one now goes to the Zibil qutusu. The database decides which case it is
// (20261027_stock_item_trash.sql); these are the words the screen shows.

export type StockTrashResult =
  | { result: 'deleted' | 'trashed' | 'gone' }
  | { result: 'in_recipe'; dishes: string[]; product: boolean }
  | { result: 'has_stock'; qty: number; unit: string }
  | { result: 'error'; message: string };

/** What the screen says for an answer, or null when it went through. */
export function stockTrashMessage(r: StockTrashResult, name: string): string | null {
  switch (r.result) {
    case 'deleted': case 'trashed': case 'gone': return null;
    case 'in_recipe':
      return r.product
        ? `«${name}» menyuda Məhsuldur — onu menyudan silin.`
        : `«${name}» bu yeməklərin reseptində var: ${r.dishes.join(', ')}. Əvvəlcə reseptdən çıxarın.`;
    case 'has_stock': return null; // asked, not refused: see stockLeftQuestion
    case 'error': return r.message;
  }
}

/** The question before a row with stock goes: "Anbarda 3 kq qalıb — silinsin?" */
export function stockLeftQuestion(qty: number, unit: string, name: string): string {
  const n = Number.isInteger(qty) ? String(qty) : String(Math.round(qty * 1000) / 1000);
  const after = 'Zibil qutusuna gedəcək, keçmiş alışlar və satışlar qalacaq.';
  // +5 in one warehouse and -5 in another add up to 0, but are not empty.
  if (qty === 0) return `${name} anbarlarda sıfır deyil: birində artıq, birində əskik var — silinsin? ${after}`;
  return `Anbarda ${n} ${unit} ${name} qalıb — silinsin? ${after}`;
}

/** An old purchase can hold an inqrediyent that is in the Zibil qutusu now.
 *  The item pickers list only live ones, so a select showed the first live
 *  name in its place. These are the lines' own items the list lacks, to show
 *  under their real name. */
export function goneItems<T extends { stockItemId: string; name: string; unit: string }>(
  lines: T[], live: { id: string }[],
): Map<string, { name: string; unit: string }> {
  const ids = new Set(live.map(i => i.id));
  return new Map(lines.filter(l => !ids.has(l.stockItemId)).map(l => [l.stockItemId, { name: `${l.name} (silinib)`, unit: l.unit }]));
}

/** Done: what the toast says. */
export function stockTrashDone(r: StockTrashResult): string {
  return r.result === 'trashed' ? 'Zibil qutusuna göndərildi' : 'Silindi';
}

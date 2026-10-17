// A set ("Set 1: ayran + dolma") is a menu item that lists the products inside
// it. The owner counts ayrans, not sets, so every screen that shows how many
// of a product went out adds the ones inside sets with these functions.

import type { MenuItem, SetPart } from '@/types';

export type ItemKind = NonNullable<MenuItem['kind']>;

/** Növ, as every screen and the menu file write it. */
export const KIND_LABEL: Record<ItemKind, string> = { product: 'Məhsul', meal: 'Yemək', set: 'Set' };

/** Növ of a menu item. Anything that has parts is a set, whatever its column
 *  says: that is how the database decides whose stock a sale takes
 *  (order_stock_lines), so the screens must not disagree with it. */
export function itemKind(m: Pick<MenuItem, 'kind' | 'setItems'>): ItemKind {
  return m.setItems?.length ? 'set' : (m.kind ?? 'product');
}

/** What can be added to the set being edited: not itself, not another set, not
 *  something already inside. A product with sizes stays on the list until each
 *  size is inside (Fanta 0.5L and Fanta 1L in one set). */
export function setChoices<T extends Pick<MenuItem, 'id' | 'kind' | 'setItems' | 'variants'>>(
  menu: T[], selfId: string | null, picked: { id: string }[],
): T[] {
  return menu.filter(m => m.id !== selfId && itemKind(m) !== 'set'
    && picked.filter(p => p.id === m.id).length < Math.max(1, m.variants?.length ?? 0));
}

/** The size a part names, if the product still has it. A part with no size, or
 *  a size deleted since, has none: the form then asks for one again. */
export function partVariant(part: { variantId?: string }, item: Pick<MenuItem, 'variants'> | undefined) {
  return part.variantId ? item?.variants?.find(v => v.id === part.variantId) : undefined;
}

/** "Ayran × 1 · Fanta · 0.5L × 2", for the menu list. A part deleted since is
 *  left out; a product with sizes and none picked says so, for the owner to fix. */
export function setLine(parts: SetPart[] | undefined, menu: Pick<MenuItem, 'id' | 'name' | 'variants'>[]): string {
  return (parts ?? []).flatMap(p => {
    const item = menu.find(m => m.id === p.id);
    if (!item) return [];
    const size = partVariant(p, item);
    const label = size ? ` · ${size.name}` : item.variants?.length ? ' · variant seçilməyib' : '';
    return [`${item.name}${label} × ${p.qty}`];
  }).join(' · ');
}

/** How many of each product went out inside sets. `sold` is how many times each
 *  menu item was sold as itself, by id. A set inside a set is not opened. */
export function soldInSets(menu: { id: string; setItems?: SetPart[] }[], sold: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of menu) {
    const n = sold[m.id] ?? 0;
    if (n === 0) continue;
    for (const p of m.setItems ?? []) out[p.id] = (out[p.id] ?? 0) + n * p.qty;
  }
  return out;
}

/** The same, per size: product id → size id → how many. A part with no size is
 *  under '', and counts only in the product's own total (soldInSets). */
export function soldInSetSizes(menu: { id: string; setItems?: SetPart[] }[], sold: Record<string, number>): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const m of menu) {
    const n = sold[m.id] ?? 0;
    if (n === 0) continue;
    for (const p of m.setItems ?? []) {
      const sizes = (out[p.id] ??= {});
      const v = p.variantId ?? '';
      sizes[v] = (sizes[v] ?? 0) + n * p.qty;
    }
  }
  return out;
}

/** Cəmi: sold alone plus sold inside sets. */
export const withSets = (r: { qty: number; inSets: number }) => r.qty + r.inSets;

/** What Cəmi is made of, for the hover note. */
export const setSplit = (r: { qty: number; inSets: number }) => `${r.qty} tək + ${r.inSets} setdə`;

/** Cleans what the form or an old row holds: no part twice (the same size of
 *  the same product), none pointing at the set itself, whole numbers from 1. */
export function cleanSetItems(selfId: string, parts: { id: string; qty: number; variantId?: string }[]): SetPart[] {
  const out: SetPart[] = [];
  for (const p of parts) {
    if (!p.id || p.id === selfId) continue;
    const qty = Math.max(1, Math.round(Number(p.qty) || 1));
    const variantId = p.variantId || undefined;
    const same = out.find(x => x.id === p.id && x.variantId === variantId);
    if (same) same.qty += qty; else out.push(variantId ? { id: p.id, qty, variantId } : { id: p.id, qty });
  }
  return out;
}

/** Menu rows for saving, in batches that each name the same columns. A dish
 *  whose set contents this screen never loaded has no `set_items` key, and must
 *  keep what the database has: sent in one upsert with rows that do name the
 *  column, it would be written as empty. */
export function menuRowBatches<T extends Record<string, unknown>>(rows: T[]): T[][] {
  return [rows.filter(r => 'set_items' in r), rows.filter(r => !('set_items' in r))].filter(b => b.length > 0);
}

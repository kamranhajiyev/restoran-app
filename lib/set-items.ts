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
 *  something already inside. */
export function setChoices<T extends Pick<MenuItem, 'id' | 'kind' | 'setItems'>>(
  menu: T[], selfId: string | null, picked: { id: string }[],
): T[] {
  return menu.filter(m => m.id !== selfId && itemKind(m) !== 'set' && !picked.some(p => p.id === m.id));
}

/** "Ayran × 1 · Dolma × 2", for the menu list. A part deleted since is left out. */
export function setLine(parts: SetPart[] | undefined, menu: { id: string; name: string }[]): string {
  return (parts ?? []).flatMap(p => {
    const name = menu.find(m => m.id === p.id)?.name;
    return name ? [`${name} × ${p.qty}`] : [];
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

/** Cəmi: sold alone plus sold inside sets. */
export const withSets = (r: { qty: number; inSets: number }) => r.qty + r.inSets;

/** What Cəmi is made of, for the hover note. */
export const setSplit = (r: { qty: number; inSets: number }) => `${r.qty} tək + ${r.inSets} setdə`;

/** Cleans what the form or an old row holds: no part twice, none pointing at
 *  the set itself, whole numbers from 1. */
export function cleanSetItems(selfId: string, parts: { id: string; qty: number }[]): SetPart[] {
  const out: SetPart[] = [];
  for (const p of parts) {
    if (!p.id || p.id === selfId) continue;
    const qty = Math.max(1, Math.round(Number(p.qty) || 1));
    const same = out.find(x => x.id === p.id);
    if (same) same.qty += qty; else out.push({ id: p.id, qty });
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

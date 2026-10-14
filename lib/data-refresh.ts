// One small download for a burst of menu or table edits.
//
// Every edit of a dish, category, table or hall made the till and admin
// download everything: menu, tables, staff, couriers and the last 200 orders,
// once per edit. Twenty dishes edited meant twenty full downloads on every open
// screen (usage review, 2026-10-14). Now a burst is gathered and only the part
// that changed is read again.

import { coalesce } from './coalesce';

export type Part = 'menu' | 'tables';

const PART_OF: Record<string, Part> = {
  menu_items: 'menu',
  categories: 'menu',
  restaurant_tables: 'tables',
  halls: 'tables',
};

/** The tables whose edits a screen re-reads a part for. */
export const DATA_TABLES = Object.keys(PART_OF);

export function partOf(table: string): Part | null {
  return PART_OF[table] ?? null;
}

/** How long a burst of edits is gathered: an import or a reorder is many rows. */
export const DATA_GATHER_MS = 2_000;

/**
 * Returns a trigger taking the table that changed. `fn` runs once per burst
 * with every part the burst touched.
 */
export function gatherParts(fn: (parts: Set<Part>) => void, ms = DATA_GATHER_MS) {
  let parts = new Set<Part>();
  const soon = coalesce(() => {
    const got = parts;
    parts = new Set();
    fn(got);
  }, ms);
  const add = (table: string) => {
    const part = partOf(table);
    if (!part) return;
    parts.add(part);
    soon();
  };
  return Object.assign(add, {
    cancel: () => { soon.cancel(); parts = new Set(); },
  });
}

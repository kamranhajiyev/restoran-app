// A table's unsent cart, as Poster keeps it: the waiter adds a coffee to table 2,
// walks off to another table, and the coffee is still there on the way back —
// and the map shows table 2 as started (Natiq, 2026-11-02).
//
// Nothing here is an order. It never reaches the database, the kitchen, the
// stock or any total; it lives on this device only (localStorage), one list per
// company. A table whose cart is emptied has no draft, so it is free again.

import type { MenuItem, OrderItem } from '@/types';

export interface TableDraft {
  items: OrderItem[];
  note: string;
  saleTypeId: string | null;
}

export type TableDrafts = Record<string, TableDraft>;

const KEY = 'tableDrafts:';

/** The drafts with this table's cart saved, or dropped when nothing is in it. */
export function putTableDraft(drafts: TableDrafts, table: number, draft: TableDraft): TableDrafts {
  const { [String(table)]: _old, ...rest } = drafts;
  if (draft.items.length === 0) return rest;
  return { ...rest, [String(table)]: draft };
}

export function dropTableDraft(drafts: TableDrafts, table: number): TableDrafts {
  return putTableDraft(drafts, table, { items: [], note: '', saleTypeId: null });
}

/**
 * The draft to open, without dishes deleted from the menu since. An empty menu
 * means it has not loaded yet, not that every dish is gone.
 */
export function openTableDraft(drafts: TableDrafts, table: number, menu: MenuItem[]): TableDraft | null {
  const draft = drafts[String(table)];
  if (!draft) return null;
  if (menu.length === 0) return draft;
  const ids = new Set(menu.map(m => m.id));
  const items = draft.items.filter(i => ids.has(i.menuItem.id));
  return items.length > 0 ? { ...draft, items } : null;
}

/** What the table card shows: the first dish, and how many other dishes. */
export function tableDraftLabel(draft: TableDraft | undefined): string {
  if (!draft || draft.items.length === 0) return '';
  const first = draft.items[0].menuItem.name;
  const more = draft.items.length - 1;
  return more > 0 ? `${first} +${more}` : first;
}

export function loadTableDrafts(companyId: string): TableDrafts {
  try {
    const raw = localStorage.getItem(KEY + companyId);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed as TableDrafts : {};
  } catch { return {}; }
}

export function saveTableDrafts(companyId: string, drafts: TableDrafts) {
  try {
    if (Object.keys(drafts).length === 0) localStorage.removeItem(KEY + companyId);
    else localStorage.setItem(KEY + companyId, JSON.stringify(drafts));
  } catch { /* private window or full storage: the cart just isn't kept */ }
}

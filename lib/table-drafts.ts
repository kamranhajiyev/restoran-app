// A table's unsent cart, as Poster keeps it: the waiter adds a coffee to table 2,
// walks off to another table, and the coffee is still there on the way back —
// and the map shows table 2 as started (Natiq, 2026-11-02).
//
// Nothing here is an order. It never reaches the database, the kitchen, the
// stock or any total; it lives on this device only (localStorage), one list per
// company. A table whose cart is emptied has no draft, so it is free again.

import type { MenuItem, OrderItem } from '@/types';
import { pricedLine, type PriceChange } from './order-types';

export interface TableDraft {
  items: OrderItem[];
  note: string;
  saleTypeId: string | null;
  /** When the cart last changed; absent on drafts saved before it was kept. */
  savedAt?: number;
}

export type TableDrafts = Record<string, TableDraft>;

const KEY = 'tableDrafts:';

// A cart nobody came back to by the next day is forgotten, not a table that
// stays blue for a week.
export const DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const round2 = (n: number) => Math.round(n * 100) / 100;

function fresh(draft: TableDraft | undefined, now: number): draft is TableDraft {
  return !!draft && draft.items.length > 0 && now - (draft.savedAt ?? 0) < DRAFT_MAX_AGE_MS;
}

/** The drafts with this table's cart saved, or dropped when nothing is in it. */
export function putTableDraft(drafts: TableDrafts, table: number, draft: TableDraft, now = Date.now()): TableDrafts {
  const { [String(table)]: _old, ...rest } = drafts;
  if (draft.items.length === 0) return rest;
  return { ...rest, [String(table)]: { ...draft, savedAt: now } };
}

export function dropTableDraft(drafts: TableDrafts, table: number): TableDrafts {
  return putTableDraft(drafts, table, { items: [], note: '', saleTypeId: null });
}

/**
 * The drafts without the ones another device overtook: a table whose order was
 * placed after its cart last changed was served from somewhere else, so the
 * cart would send the same dishes again when the next guests sit there. A cart
 * typed after the order (a second order on a busy table) stays. Unchanged
 * drafts come back as the same object, so nothing is saved for nothing.
 */
export function dropOvertakenDrafts(
  drafts: TableDrafts, orders: { tableNumber?: number | null; createdAt: string }[],
): TableDrafts {
  const overtaken = Object.keys(drafts).filter(table => orders.some(o =>
    String(o.tableNumber) === table && Date.parse(o.createdAt) > (drafts[table].savedAt ?? 0)));
  if (overtaken.length === 0) return drafts;
  return Object.fromEntries(Object.entries(drafts).filter(([table]) => !overtaken.includes(table)));
}

/**
 * The draft to open, priced from today's menu: a price changed since the cart
 * was saved is the new price, as if the dish were tapped again now (size or
 * dish price, then the chosen options, then the order type's change, the same
 * sum the menu screen makes). Dishes and sizes deleted since are left out. An
 * empty menu means it has not loaded yet, not that every dish is gone.
 */
export function openTableDraft(
  drafts: TableDrafts, table: number, menu: MenuItem[], change: PriceChange, now = Date.now(),
): TableDraft | null {
  const draft = drafts[String(table)];
  if (!fresh(draft, now)) return null;
  if (menu.length === 0) return draft;
  const items = draft.items.flatMap(line => {
    const current = menu.find(m => m.id === line.menuItem.id);
    if (!current) return [];
    const variant = line.variantId ? current.variants?.find(v => v.id === line.variantId) : undefined;
    if (line.variantId && !variant) return [];
    const options = (line.modifiersDetail ?? []).reduce((s, d) => s + d.price, 0);
    const { price, menuPrice } = pricedLine(round2((variant ?? current).price + options), change);
    const { menuPrice: _old, ...rest } = line;
    return [{ ...rest, menuItem: { ...line.menuItem, price }, ...(menuPrice !== undefined ? { menuPrice } : {}) }];
  });
  return items.length > 0 ? { ...draft, items } : null;
}

/** What the table card shows: the first dish, and how many other dishes. */
export function tableDraftLabel(draft: TableDraft | undefined, now = Date.now()): string {
  if (!fresh(draft, now)) return '';
  const first = draft.items[0].menuItem.name;
  const more = draft.items.length - 1;
  return more > 0 ? `${first} +${more}` : first;
}

/** This company's drafts, without the ones too old to keep. */
export function loadTableDrafts(companyId: string, now = Date.now()): TableDrafts {
  try {
    const raw = localStorage.getItem(KEY + companyId);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(Object.entries(parsed as TableDrafts).filter(([, d]) => fresh(d, now)));
  } catch { return {}; }
}

export function saveTableDrafts(companyId: string, drafts: TableDrafts) {
  try {
    if (Object.keys(drafts).length === 0) localStorage.removeItem(KEY + companyId);
    else localStorage.setItem(KEY + companyId, JSON.stringify(drafts));
  } catch { /* private window or full storage: the cart just isn't kept */ }
}

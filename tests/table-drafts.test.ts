// A table's unsent cart, as Poster keeps it (Natiq, 2026-11-02): leave table 2
// with a coffee in the cart and the coffee is still there on the way back, and
// the map shows the table as started. Until now going back to the map threw the
// cart away. An empty cart is no draft: the table is free again.

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  dropTableDraft, loadTableDrafts, openTableDraft, putTableDraft, saveTableDrafts, tableDraftLabel,
  type TableDraft,
} from '@/lib/table-drafts';
import type { MenuItem, OrderItem } from '@/types';

const latte: MenuItem = { id: 'l', name: 'Latte', price: 5, category: 'Kofe', available: true };
const tea: MenuItem = { id: 't', name: 'Çay', price: 2, category: 'Çay', available: true };
const line = (m: MenuItem, quantity: number): OrderItem => ({ menuItem: m, quantity });
const draft = (...items: OrderItem[]): TableDraft => ({ items, note: '', saleTypeId: null });

describe('one unsent cart per table', () => {
  it('keeps each table apart', () => {
    let d = putTableDraft({}, 2, draft(line(latte, 1)));
    d = putTableDraft(d, 5, draft(line(tea, 2)));
    expect(openTableDraft(d, 2, [latte, tea])?.items).toEqual([line(latte, 1)]);
    expect(openTableDraft(d, 5, [latte, tea])?.items).toEqual([line(tea, 2)]);
    expect(openTableDraft(d, 7, [latte, tea])).toBeNull();
  });

  it('frees the table when every item is removed', () => {
    const d = putTableDraft(putTableDraft({}, 2, draft(line(latte, 1))), 2, draft());
    expect(d).toEqual({});
    expect(tableDraftLabel(d['2'])).toBe('');
  });

  it('is gone once the order is sent', () => {
    expect(dropTableDraft(putTableDraft({}, 2, draft(line(latte, 1))), 2)).toEqual({});
  });

  it('leaves out dishes deleted from the menu, but not before the menu has loaded', () => {
    const d = putTableDraft({}, 2, draft(line(latte, 1), line(tea, 1)));
    expect(openTableDraft(d, 2, [tea])?.items).toEqual([line(tea, 1)]);
    expect(openTableDraft(d, 2, [])?.items).toHaveLength(2);
    expect(openTableDraft(putTableDraft({}, 2, draft(line(latte, 1))), 2, [tea])).toBeNull();
  });

  it('shows the first dish and how many more on the table', () => {
    expect(tableDraftLabel(draft(line(latte, 1)))).toBe('Latte');
    expect(tableDraftLabel(draft(line(latte, 2), line(tea, 3)))).toBe('Latte +1');
  });
});

describe('kept on this device', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: k => store.get(k) ?? null,
      setItem: (k, v) => { store.set(k, v); },
      removeItem: k => { store.delete(k); },
      clear: () => store.clear(),
      key: () => null,
      get length() { return store.size; },
    };
  });

  it('survives a reload, one list per company', () => {
    saveTableDrafts('a', putTableDraft({}, 2, draft(line(latte, 1))));
    expect(loadTableDrafts('a')['2'].items).toEqual([line(latte, 1)]);
    expect(loadTableDrafts('b')).toEqual({});
  });

  it('reads nothing rather than breaking on bad storage', () => {
    localStorage.setItem('tableDrafts:a', '{not json');
    expect(loadTableDrafts('a')).toEqual({});
  });
});

describe('the seller page', () => {
  const page = readFileSync('app/seller/page.tsx', 'utf8');

  it('opens a table with its draft and drops it when the order is sent', () => {
    expect(page).toMatch(/openTableDraft\(tableDrafts, tableNum, menu\)/);
    expect(page).toMatch(/dropTableDraft\(d, order\.tableNumber\)/);
  });
});

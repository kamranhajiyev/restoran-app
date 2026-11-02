// A table's unsent cart, as Poster keeps it (Natiq, 2026-11-02): leave table 2
// with a coffee in the cart and the coffee is still there on the way back, and
// the map shows the table as started. Until now going back to the map threw the
// cart away. An empty cart is no draft: the table is free again.

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { NO_CHANGE } from '@/lib/order-types';
import {
  DRAFT_MAX_AGE_MS, dropOvertakenDrafts, dropTableDraft, loadTableDrafts, openTableDraft, putTableDraft, saveTableDrafts, tableDraftLabel,
  type TableDraft,
} from '@/lib/table-drafts';
import type { MenuItem, OrderItem } from '@/types';

const latte: MenuItem = { id: 'l', name: 'Latte', price: 5, category: 'Kofe', available: true };
const tea: MenuItem = { id: 't', name: 'Çay', price: 2, category: 'Çay', available: true };
const line = (m: MenuItem, quantity: number): OrderItem => ({ menuItem: m, quantity });
const draft = (...items: OrderItem[]): TableDraft => ({ items, note: '', saleTypeId: null, savedAt: Date.now() });

describe('one unsent cart per table', () => {
  it('keeps each table apart', () => {
    let d = putTableDraft({}, 2, draft(line(latte, 1)));
    d = putTableDraft(d, 5, draft(line(tea, 2)));
    expect(openTableDraft(d, 2, [latte, tea], NO_CHANGE)?.items).toEqual([line(latte, 1)]);
    expect(openTableDraft(d, 5, [latte, tea], NO_CHANGE)?.items).toEqual([line(tea, 2)]);
    expect(openTableDraft(d, 7, [latte, tea], NO_CHANGE)).toBeNull();
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
    expect(openTableDraft(d, 2, [tea], NO_CHANGE)?.items).toEqual([line(tea, 1)]);
    expect(openTableDraft(d, 2, [], NO_CHANGE)?.items).toHaveLength(2);
    expect(openTableDraft(putTableDraft({}, 2, draft(line(latte, 1))), 2, [tea], NO_CHANGE)).toBeNull();
  });

  it('opens at today\'s prices: dish, size, options, then the order type', () => {
    const cup: MenuItem = { ...latte, variants: [{ id: 'big', name: 'Böyük', price: 7 }] };
    const saved = putTableDraft({}, 2, draft(
      line(latte, 1),
      { menuItem: { ...cup, price: 8 }, quantity: 2, variantId: 'big', modifiersDetail: [{ groupName: 'Şərbət', optionName: 'Karamel', price: 1 }] },
    ));
    const today = [{ ...latte, price: 6, variants: [{ id: 'big', name: 'Böyük', price: 9 }] }];
    const opened = openTableDraft(saved, 2, today, NO_CHANGE)!.items;
    expect(opened.map(i => i.menuItem.price)).toEqual([6, 10]);
    const plus10 = openTableDraft(saved, 2, today, { sign: 1, amount: 10, unit: '%' })!.items;
    expect(plus10[0].menuPrice).toBe(6);
    expect(plus10[0].menuItem.price).toBe(6.6);
    expect(openTableDraft(saved, 2, [{ ...latte, variants: [] }], NO_CHANGE)!.items).toHaveLength(1);
  });

  it('is forgotten after 12 hours', () => {
    const d = putTableDraft({}, 2, draft(line(latte, 1)), 0);
    expect(tableDraftLabel(d['2'], DRAFT_MAX_AGE_MS - 1)).toBe('Latte');
    expect(tableDraftLabel(d['2'], DRAFT_MAX_AGE_MS)).toBe('');
    expect(openTableDraft(d, 2, [latte], NO_CHANGE, DRAFT_MAX_AGE_MS)).toBeNull();
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
    expect(page).toMatch(/openTableDraft\(tableDrafts, tableNum!, menu, changeFor\(/);
    expect(page).toMatch(/dropTableDraft\(d, order\.tableNumber\)/);
  });
});

// 2026-11-02: a cart left on one till came back after another till served the
// table, ready to send the same dishes again to the next guests.
describe('a cart another till overtook', () => {
  const draft = (savedAt: number): TableDraft => ({ items: [{ menuItem: { id: 'tea', name: 'Çay' }, quantity: 1 } as never], note: '', saleTypeId: null, savedAt });
  const at = (ms: number) => new Date(ms).toISOString();

  it('goes when the table was ordered on after the cart last changed', () => {
    const drafts = { '2': draft(1000), '3': draft(1000) };
    expect(Object.keys(dropOvertakenDrafts(drafts, [{ tableNumber: 2, createdAt: at(5000) }]))).toEqual(['3']);
  });

  it('stays when it was typed after the order (a second order on a busy table), or nothing changed', () => {
    const drafts = { '2': draft(9000) };
    expect(dropOvertakenDrafts(drafts, [{ tableNumber: 2, createdAt: at(5000) }])).toBe(drafts);
    expect(dropOvertakenDrafts(drafts, [{ tableNumber: 4, createdAt: at(99999) }])).toBe(drafts);
  });

  it('is checked by the seller page against the open orders', () => {
    const page = readFileSync('app/seller/page.tsx', 'utf8');
    expect(page).toMatch(/dropOvertakenDrafts\(d, orders\.filter\(isOrderOpen\)\)/);
  });
});

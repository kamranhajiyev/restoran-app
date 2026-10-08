// Code review, 2026-10-08: four screens treated a failed read as an empty answer.
// - Admin: a menu reload that failed set the menu to [], and the next edit
//   saved that list, which deletes every dish missing from it: the whole menu.
// - Statistics showed 0 ₼ for the range and cached it for past days.
// - The kitchen screen stayed empty after a failed first load.
// - Excel summed deleted orders and left out courier money.

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Order } from '@/types';

let menuRead: { data: unknown; error: unknown } = { data: [], error: null };
const writes: string[] = [];

const chain = (result: unknown) => {
  const c: Record<string, unknown> = {};
  for (const k of ['select', 'order', 'eq', 'not', 'in', 'neq']) c[k] = () => c;
  c.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
  return c;
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => chain(table === 'menu_items' ? menuRead : { data: [], error: null }),
      upsert: async () => { writes.push(`upsert ${table}`); return { error: null }; },
      delete: () => { writes.push(`delete ${table}`); return chain({ error: null }); },
      insert: async () => ({ error: null }),
    }),
  },
}));

const read = (p: string) => readFileSync(p, 'utf8');

describe('the menu', () => {
  beforeEach(() => { writes.length = 0; });

  it('cannot be saved from a list that came from a failed read', async () => {
    vi.resetModules();
    const store = await import('@/lib/store');
    store.setCompanyContext('c1');
    menuRead = { data: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Çay', price: 1, category: 'İçki', available: true }], error: null };
    expect(await store.fetchMenu()).toHaveLength(1);

    menuRead = { data: null, error: { message: 'timeout' } };
    const shown = await store.fetchMenu();
    expect(shown).toEqual([]);

    const err = await store.saveMenu([...shown, { id: 'new', name: 'Kofe', price: 3, category: 'İçki', available: true } as never]);
    expect(err).not.toBeNull();
    expect(writes).toEqual([]);
  });

  it('admin keeps its menu when a reload fails', () => {
    const admin = read('app/admin/page.tsx');
    expect(admin).not.toMatch(/setMenu\(await fetchMenu\(\)\)/);
    expect(admin).toMatch(/if \(m\) setMenu\(m\);/);
    expect(admin).toMatch(/if \(c\) setCategories\(c\);/);
  });
});

describe('statistics and the orders range', () => {
  it('show a failed read as a failure, not as no sales', () => {
    const admin = read('app/admin/page.tsx');
    expect(admin).toMatch(/if \(!o\) \{ setStatsFailed\(true\); return; \}/);
    expect(admin).not.toMatch(/fetchOrders\(\{ from, to \}\)/);
  });
});

describe('the kitchen screen', () => {
  it('tries its first load again until it lands', () => {
    const station = read('app/station/page.tsx');
    expect(station).toMatch(/if \(!ok\) retry = setTimeout\(load, LOAD_RETRY_MS\)/);
    expect(station).not.toMatch(/fetchMenu\(\)\.then\(setMenu\)/);
  });
});

describe('the Excel export', () => {
  it('counts courier money and leaves deleted orders out of the total', async () => {
    const { excelMoney } = await import('@/lib/excel');
    const o = (x: Partial<Order>) => ({ status: 'ödənilib', items: [], ...x }) as Order;
    expect(excelMoney(o({ cashAmount: 5, courierCash: 28, courierCard: 2 }))).toEqual({ cash: 33, card: 2, counted: true });
    expect(excelMoney(o({ status: 'silinib' })).counted).toBe(false);
    expect(excelMoney(o({ status: 'ləğv edildi' })).counted).toBe(false);
  });
});

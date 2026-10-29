// 2026-10-29: a set was one line at one sex. "Set 2" printed in the kitchen and
// the bar never heard about the Fanta inside it. Now each part goes to the sex
// that makes it, on the slip, on the sex screen and in the seller's "hazır".

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lineReady, menuIndex, prepLines, readyStationIds, sliceForStation, stationsForItem } from '@/lib/stations';
import type { MenuItem, OrderItem, Station } from '@/types';

const stations = [
  { id: 'kitchen', name: 'Mətbəx' },
  { id: 'bar', name: 'Bar' },
] as Station[];

const menu: MenuItem[] = [
  { id: 'plov', name: 'Plov', price: 10, category: 'X', stationId: 'kitchen',
    variants: [{ id: 'q', name: 'qulyaj', price: 10 }] },
  { id: 'fanta', name: 'Fanta', price: 2, category: 'X', stationId: 'bar' },
  { id: 'su', name: 'Su', price: 1, category: 'X', stationId: null },
  { id: 'set2', name: 'Set 2', price: 12, category: 'X', stationId: 'kitchen', kind: 'set',
    setItems: [{ id: 'plov', qty: 1, variantId: 'q' }, { id: 'fanta', qty: 2 }] },
  { id: 'empty', name: 'Old set', price: 5, category: 'X', stationId: 'bar', kind: 'set',
    setItems: [{ id: 'gone', qty: 1 }] },
] as MenuItem[];
const byId = menuIndex(menu);

const line = (id: string, quantity: number, extra: Partial<OrderItem> = {}): OrderItem =>
  ({ id: `row-${id}`, menuItem: { ...byId.get(id)!, name: byId.get(id)!.name }, quantity, ...extra });

describe('a set at the sexes', () => {
  it('goes as its parts, each to its own sex, named with size and set', () => {
    const lines = prepLines(line('set2', 2, { modifiers: 'acısız' }), byId, stations);
    expect(lines.map(l => [l.stationId, l.item.menuItem.name, l.item.quantity, l.item.modifiers])).toEqual([
      ['kitchen', 'Plov · qulyaj (Set 2)', 2, 'acısız'],
      ['bar', 'Fanta (Set 2)', 4, 'acısız'],
    ]);
    expect(new Set(lines.map(l => l.item.id)).size).toBe(2);
  });

  it('leaves a dish as it was, and a dish with no sex goes to the first', () => {
    expect(stationsForItem(line('fanta', 1), byId, stations)).toEqual(['bar']);
    expect(stationsForItem(line('su', 1), byId, stations)).toEqual(['kitchen']);
  });

  it('goes whole to its own sex when nothing inside is left', () => {
    expect(prepLines(line('empty', 1), byId, stations).map(l => [l.stationId, l.item.menuItem.name]))
      .toEqual([['bar', 'Old set']]);
  });

  it('shows each sex screen only its part', () => {
    const order = { items: [line('set2', 1)], removedItems: [], createdAt: '2026-10-29T10:00:00Z' };
    expect(sliceForStation(order, 'bar', byId, stations).items.map(i => i.menuItem.name)).toEqual(['Fanta (Set 2)']);
    expect(sliceForStation(order, 'kitchen', byId, stations).items.map(i => i.menuItem.name)).toEqual(['Plov · qulyaj (Set 2)']);
  });

  it('is ready for the seller only when every sex is', () => {
    const set = line('set2', 1);
    expect(lineReady(set, new Set(['kitchen']), byId, stations)).toBe(false);
    expect(lineReady(set, new Set(['kitchen', 'bar']), byId, stations)).toBe(true);
  });

  it('re-opens the bar when a set is added after the bar said done', () => {
    const order = { id: 'o1', items: [line('set2', 1, { createdAt: '2026-10-29T10:05:00Z' })] };
    const rows = [{ orderId: 'o1', stationId: 'bar', readyAt: '2026-10-29T10:00:00Z' }];
    expect(readyStationIds(order, rows, byId, stations).has('bar')).toBe(false);
  });
});

describe('every screen splits the same way', () => {
  it('the seller and the till printing read the shared rule, not the set\'s own sex', () => {
    const seller = readFileSync('app/seller/page.tsx', 'utf8');
    expect(seller).not.toMatch(/stationForItem\(/);
    expect(seller).toMatch(/lineReady\(item, ready, menuById, stations\)/);
    const print = readFileSync('lib/desktopPrint.ts', 'utf8');
    expect(print).not.toMatch(/resolveStationId\(/);
    expect(print).toMatch(/prepLines\(oi, menuById, stations\)/);
    expect(print).toMatch(/printedStationIds: done/);
  });

  it('the exe and APK get what is inside each set, or they would print it whole', () => {
    const route = readFileSync('app/api/public-menu/route.ts', 'utf8');
    expect(route).toMatch(/\.select\('[^']*\bset_items\b/);
    expect(route).toMatch(/setItems:/);
  });

  it('every saved line keeps all the sexes it printed at', () => {
    for (const f of ['app/api/add-order/route.ts', 'app/api/add-order-items/route.ts', 'lib/store.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src.match(/printed_station_id:/g)?.length, f).toBe(src.match(/printed_station_ids:/g)?.length);
    }
  });

  it('every server ticket reads prep_lines', () => {
    const sql = readFileSync('supabase/migrations/20261101_set_parts_to_stations.sql', 'utf8');
    for (const fn of ['insert', 'ghost', 'removed', 'delete', 'order_cancel', 'table_move']) {
      const body = sql.split(`function public.enqueue_print_jobs_${fn}()`)[1].split('end $function$')[0];
      expect(body, fn).toMatch(/prep_lines\(/);
      expect(body, fn).not.toMatch(/mi\.station_id/);
    }
    const remove = sql.split('function public.remove_order_items(')[1];
    expect(remove).toMatch(/prep_lines\(/);
    expect(sql).toMatch(/st\.id = any\(coalesce\(n\.printed_station_ids/);
    expect(sql).toMatch(/revoke execute on function public\.prep_lines\([^)]*\) from public, anon, authenticated/);
  });
});

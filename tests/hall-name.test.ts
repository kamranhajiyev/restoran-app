// Asked for 2026-10-24: orders and receipts name the hall too. Two halls can
// each have a "Masa 5", and a receipt that says only that is two tables.

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { orderPlace, tableTitle } from '@/lib/order-place';
import { tableSales } from '@/lib/place-sales';
import type { Order } from '@/types';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

const halls = [{ id: 'zal', name: 'Zal' }, { id: 'ter', name: 'Terras' }];
const tables = [
  { id: 1, name: 'Masa 5', hallId: 'zal' },
  { id: 2, name: 'Masa 5', hallId: 'ter' },
  { id: 3, name: '7' },                      // from before halls: the first hall
  { id: 4, name: 'Terras 3', hallId: 'ter' },
];
const read = (p: string) => readFileSync(p, 'utf8');
// Every tableTitle(tables, …) call on a screen, which must all pass the halls.
const withoutHalls = (src: string) =>
  (src.match(/tableTitle\(tables, [^)\n]*\)/g) ?? []).filter(c => !c.endsWith(', halls)'));

describe('the hall beside the table', () => {
  it('is written in front of the table when there are two halls or more', () => {
    expect(tableTitle(tables, 1, undefined, halls)).toBe('Zal · Masa 5');
    expect(tableTitle(tables, 2, 'Masa 5', halls)).toBe('Terras · Masa 5');
    expect(tableTitle(tables, 3, undefined, halls)).toBe('Zal · Masa 7');
    expect(orderPlace({ tableNumber: 2 }, { tables, tablesOn: true, deliveryOn: false, halls })).toBe('Terras · Masa 5');
  });

  it('is left off with one hall, a name that already says it, or a table that is gone', () => {
    expect(tableTitle(tables, 1, undefined, [halls[0]])).toBe('Masa 5');
    expect(tableTitle(tables, 4, undefined, halls)).toBe('Terras 3');
    expect(tableTitle(tables, 99, 'Masa 9', halls)).toBe('Masa 9');
  });

  it('keeps two same-named tables apart in the sales by table', () => {
    const o = (tableNumber: number) => ({ tableNumber }) as Order;
    const rows = tableSales([o(1), o(2)], tables, () => 10, halls);
    expect(rows.map(r => r.name).sort()).toEqual(['Terras · Masa 5', 'Zal · Masa 5']);
  });

  it('is read from the hall the exe and APK keep as hall_id', async () => {
    const { localTables } = await import('@/lib/store');
    expect(localTables([{ id: 1, name: 'Masa 5', capacity: 4, hall_id: 'ter' }])[0].hallId).toBe('ter');
  });

  it('reaches every screen and every paper that names a table', () => {
    const seller = read('app/seller/page.tsx');
    expect(seller).toContain('placeOf(order, { tables, tablesOn, deliveryOn, halls })');
    expect(withoutHalls(seller)).toEqual([]);
    expect(seller).toMatch(/withHall\(tables\.find/);
    const admin = read('app/admin/page.tsx');
    expect(admin).toContain('{ tables, tablesOn, deliveryOn, halls }');
    expect(withoutHalls(admin)).toEqual([]);
    expect(admin).toContain('tableSales(chartPaid, tables, orderTotal, halls)');
    expect(withoutHalls(read('app/station/page.tsx'))).toEqual([]);
    expect(read('lib/desktopPrint.ts')).toContain('tableTitle(known.tables, id, undefined, known.halls)');
  });
});

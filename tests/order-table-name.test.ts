// Test Restoran, 2026-10-14: a table that had ever been sold at could not be
// deleted — every order linked to it. An order now keeps its table's name, so
// the table can go and history still reads "Masa 5".

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { movedToTable, orderPlace, tableTitle } from '@/lib/order-place';
import { tableSales } from '@/lib/place-sales';
import type { Order } from '@/types';

const sql = readFileSync('supabase/migrations/20261024_order_table_name.sql', 'utf8');
const tables = [{ id: 7, name: 'Masa 5 (yeni)' }];
const cfg = { tables, tablesOn: true, deliveryOn: false };

describe('an order on a table', () => {
  it('shows the name it was taken under, after a rename or a delete', () => {
    expect(tableTitle(tables, 7, 'Masa 5')).toBe('Masa 5');
    expect(tableTitle([], 3, 'Terras 2')).toBe('Terras 2');
    expect(tableTitle([], 3, '4')).toBe('Masa 4');
    expect(orderPlace({ tableNumber: 3, tableName: 'Masa 5' }, cfg)).toBe('Masa 5');
  });

  it('falls back to the table as it is now while the server has not named it', () => {
    expect(tableTitle(tables, 7)).toBe('Masa 5 (yeni)');
    expect(orderPlace({ tableNumber: 7 }, cfg)).toBe('Masa 5 (yeni)');
  });

  it('drops the old table\'s name when moved, on the browser till and the exe', () => {
    const moved = movedToTable({ tableNumber: 3, tableName: 'Masa 5' }, 7);
    expect(moved).toEqual({ tableNumber: 7, tableName: undefined });
    expect(orderPlace(moved, cfg)).toBe('Masa 5 (yeni)');
    expect(readFileSync('app/seller/page.tsx', 'utf8')).toMatch(/o\.id === moving\.id \? movedToTable\(o, target\) : o/);
    expect(readFileSync('lib/till-store/write.ts', 'utf8')).toMatch(/putOrder\(companyId, movedToTable\(found, tableId\)\)/);
  });

  it('is still a table order when its table is gone', () => {
    expect(orderPlace({ tableNumber: 3, tableName: 'Masa 5' }, { ...cfg, tables: [] })).toBe('Masa 5');
  });

  it('counts in statistics under the name it was sold under', () => {
    const o = (tableNumber: number, tableName?: string) => ({ tableNumber, tableName }) as Order;
    const rows = tableSales([o(3, 'Masa 5'), o(7, 'Masa 5'), o(7)], tables, () => 10);
    expect(rows).toEqual([
      { name: 'Masa 5', rev: 20, count: 2 },
      { name: 'Masa 5 (yeni)', rev: 10, count: 1 },
    ]);
  });
});

describe('the database', () => {
  it('names every order itself, whoever wrote it, and fills in the old ones', () => {
    expect(sql).toMatch(/before insert or update of table_id on public\.orders/);
    expect(sql).toMatch(/update public\.orders o\s+set table_name = t\.name/);
  });

  it('lets a table with past orders go, but not one with an open order', () => {
    expect(sql).toMatch(/drop constraint if exists orders_table_id_fkey/);
    expect(sql).toMatch(/before delete on public\.restaurant_tables/);
    expect(readFileSync('lib/store.ts', 'utf8')).toMatch(/table_has_open_order/);
  });

  it('renames open orders only, so paid ones keep their day\'s name', () => {
    expect(sql).toMatch(/after update of name on public\.restaurant_tables/);
    expect(sql).toMatch(/status not in \('ödənilib', 'ləğv edildi', 'silinib'\)/);
  });

  it('every screen reads the saved name', () => {
    expect(readFileSync('lib/store.ts', 'utf8')).toMatch(/tableName: o\.table_name \?\? undefined,/);
    expect(readFileSync('app/api/public-orders/route.ts', 'utf8')).toMatch(/tableName: o\.table_name \?\? undefined,/);
    for (const f of ['app/seller/page.tsx', 'app/admin/page.tsx', 'app/station/page.tsx']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/tableTitle\(tables, (order|paidOrder|card\.order)\.tableNumber\)/);
    }
  });

  it('gives the public key nothing', () => {
    for (const fn of ['order_table_name', 'table_rename_open_orders', 'table_delete_guard']) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${fn}\\(\\) from public, anon, authenticated;`));
    }
  });
});

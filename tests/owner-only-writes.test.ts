// Code review, 2026-10-08: a cashier or kitchen login only sees its own screen,
// but the database only asked "same restaurant?", so either could change menu
// prices, tables, couriers, stock and settings, or delete orders, straight from
// the browser. 20261011_owner_only_writes.sql gives those writes to the owner.
//
// The other half: the cashier and kitchen screens must never need one of them,
// or they break. This fails if either screen starts calling one.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20261011_owner_only_writes.sql', 'utf8');
const store = readFileSync('lib/store.ts', 'utf8');

const OWNER_TABLES = [
  'couriers', 'halls', 'modifier_groups', 'recipe_lines', 'stations', 'stock_items',
  'stock_receipts', 'suppliers', 'warehouses', 'trash_items',
  'categories', 'menu_items', 'restaurant_tables', 'modifier_options', 'menu_item_modifier_groups',
];
const OWNER_FUNCTIONS = [
  'add_supplier_payment', 'delete_warehouse', 'record_count', 'record_receipt',
  'record_transfer', 'record_writeoff', 'retry_order_stock', 'update_receipt',
  'void_receipt', 'void_transfer', 'set_brand_color', 'set_logo_url',
  'set_menu_only', 'set_qr_enabled',
  'correct_shift_totals', 'update_shift_movement', 'delete_shift_movement',
];
// What the till itself writes: closing these would stop sales.
const TILL_TABLES = ['order_items', 'cash_shifts', 'print_jobs', 'order_station_ready', 'push_subscriptions'];

describe('the database', () => {
  it('gives every setup table and admin function to the owner', () => {
    for (const t of OWNER_TABLES) expect(sql, t).toContain(`'${t}'`.replace(/'(modifier_options|menu_item_modifier_groups)'/, '$1_owner_write'));
    for (const f of OWNER_FUNCTIONS) expect(sql, f).toContain(`'${f}'`);
    expect(sql).toMatch(/p\.role = 'owner' and p\.active and c\.active and c\.trashed_at is null/);
    expect(sql).toMatch(/create policy orders_delete on public\.orders for delete\s+using \(\(company_id = get_my_owner_company_id\(\)\)/);
  });

  it('leaves what the till writes alone', () => {
    for (const t of TILL_TABLES) expect(sql, t).not.toMatch(new RegExp(`on public\\.${t}\\b`));
    expect(sql).not.toMatch(/orders_(insert|update)/);
  });
});

/** Store functions that write an owner-only table or call an owner-only function. */
function ownerWriters(): string[] {
  const starts = [...store.matchAll(/^export (?:async )?function (\w+)/gm)];
  return starts.flatMap((m, i) => {
    const body = store.slice(m.index, starts[i + 1]?.index ?? store.length);
    const writesTable = OWNER_TABLES.some(t =>
      new RegExp(`from\\('${t}'\\)\\s*\\.(insert|update|upsert|delete)\\(`).test(body));
    const callsFn = OWNER_FUNCTIONS.some(f => body.includes(`rpc('${f}'`));
    const deletesOrder = /from\('orders'\)\s*\.delete\(/.test(body);
    return writesTable || callsFn || deletesOrder ? [m[1]] : [];
  });
}

function storeImports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const block = src.match(/import \{([^}]*)\} from '@\/lib\/store'/)?.[1] ?? '';
  return block.split(',').map(s => s.trim().replace(/^type\s+/, '')).filter(Boolean);
}

describe('the cashier and kitchen screens', () => {
  const writers = ownerWriters();

  it('find the owner-only writes in the store', () => {
    expect(writers).toEqual(expect.arrayContaining(['setBrandColor', 'saveMenu', 'recordReceipt']));
  });

  it.each(['app/seller/page.tsx', 'app/station/page.tsx'])('%s calls none of them', file => {
    expect(storeImports(file).filter(n => writers.includes(n))).toEqual([]);
  });
});

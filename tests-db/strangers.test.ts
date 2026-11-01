// The public key, for real, on "restoran testing": it is in every browser, so
// it is anyone. It must read and change nothing of a restaurant's, run none of
// the till's or the admin's functions, and still show the QR menu. Then
// supabase/checks/anon_reach.sql, run on the database itself, must come back
// empty (AGENTS.md: the public key gets nothing).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TESTING_REF } from '@/lib/testing-db';
import { admin, anon, companyA } from './setup';

// Every table the app reads or writes.
const TABLES = [
  'orders', 'order_items', 'profiles', 'cash_shifts', 'restaurant_tables', 'couriers', 'menu_items',
  'courier_payments', 'trash_items', 'stations', 'print_jobs', 'halls', 'stock_items', 'recipe_lines',
  'modifier_groups', 'suppliers', 'stock_movements', 'order_station_ready', 'modifier_options',
  'menu_item_modifier_groups', 'finance_accounts', 'categories', 'applied_mutations', 'warehouses',
  'supplier_payments', 'stock_receipts', 'push_subscriptions', 'finance_transactions', 'finance_closings',
  'staff', 'login_events', 'finance_sources', 'view_as_events', 'stock_transfers', 'stock_balances',
  'health_reports', 'staff_pin_state', 'company_order_counters',
];

const nobody = '00000000-0000-0000-0000-000000000000';

describe('a stranger with the public key', () => {
  it("reads nothing from any of a restaurant's tables", async () => {
    const seen: string[] = [];
    for (const t of TABLES) {
      const { data } = await anon.from(t).select('*').limit(1);
      if (data?.length) seen.push(t);
    }
    expect(seen).toEqual([]);
  });

  it("never reads a till's secret link", async () => {
    const { data, error } = await anon.from('companies').select('seller_token').eq('id', companyA.id);
    expect(error !== null || !data?.length).toBe(true);
  });

  it('adds nothing to any table', async () => {
    const added: string[] = [];
    for (const t of TABLES) {
      const { error } = await anon.from(t).insert({ company_id: companyA.id });
      if (!error) added.push(t);
    }
    expect(added).toEqual([]);
  });

  it("changes and deletes none of a restaurant's rows", async () => {
    // Counted before and after: other tests leave a deleted order on purpose.
    const snapshot = async () => {
      const company = await admin.from('companies').select('name').eq('id', companyA.id).single();
      const dishes = await admin.from('menu_items').select('id', { count: 'exact', head: true }).eq('company_id', companyA.id);
      const deleted = await admin.from('orders').select('id', { count: 'exact', head: true })
        .eq('company_id', companyA.id).eq('status', 'silinib');
      return { name: company.data!.name, dishes: dishes.count, deleted: deleted.count };
    };
    const before = await snapshot();
    await anon.from('companies').update({ name: 'hacked' }).eq('id', companyA.id);
    await anon.from('menu_items').delete().eq('company_id', companyA.id);
    await anon.from('orders').update({ status: 'silinib' }).eq('company_id', companyA.id);
    expect(await snapshot()).toEqual(before);
  });

  it("runs none of the till's or the admin's functions", async () => {
    const calls: [string, Record<string, unknown>][] = [
      ['claim_print_jobs', { p_limit: 1 }],
      ['append_shift_movement', { shift_id: nobody, movement: {} }],
      ['remove_order_items', { p_order_id: 'x', p_lines: [], p_by: 'x', p_company: companyA.id }],
      ['verify_staff_pin_for_company', { p_company_id: companyA.id, p_pin: '1234', p_device_id: 'x' }],
      ['verify_staff_card_in', { p_company_id: companyA.id, p_card: '1', p_device_id: 'x' }],
      ['create_staff', { p_name: 'x', p_pin: '1234', p_role: 'seller' }],
      ['set_staff_pin', { p_id: nobody, p_pin: '1234' }],
      ['delete_staff', { p_id: nobody }],
      ['correct_shift_totals', { shift_id: nobody, new_counted_cash: 0, new_counted_card: 0, by_name: 'x' }],
    ];
    const ran: string[] = [];
    for (const [fn, args] of calls) {
      const { error } = await anon.rpc(fn, args);
      if (!error || !/permission denied/i.test(error.message)) ran.push(`${fn}: ${error?.message ?? 'ran'}`);
    }
    expect(ran).toEqual([]);
  });

  it('still sees the QR menu', async () => {
    expect((await anon.rpc('get_public_menu_items', { p_company_id: companyA.id })).error).toBeNull();
    expect((await anon.rpc('get_public_categories', { p_company_id: companyA.id })).error).toBeNull();
  });
});

describe('the database check', () => {
  const token = process.env.SUPABASE_ACCESS_TOKEN;

  it.skipIf(!token)('finds no door open to the public key (anon_reach.sql is empty)', async () => {
    const res = await fetch(`https://api.supabase.com/v1/projects/${TESTING_REF}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: readFileSync('supabase/checks/anon_reach.sql', 'utf8') }),
    });
    expect(res.status).toBeLessThan(300);
    expect(await res.json()).toEqual([]);
  });
});

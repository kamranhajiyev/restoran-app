// 2026-10-08: a sale whose stock could not be taken off went through with only a
// line in the Postgres log, which no owner reads, so the balances drifted with
// nobody knowing. The order now carries the reason, Anbar shows it, and the
// owner can try again.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20261008_stock_failures.sql', 'utf8');
const panel = readFileSync('components/AnbarPanel.tsx', 'utf8');
const fn = (name: string) => sql.slice(sql.indexOf(`function public.${name}(`), sql.indexOf('end $function$', sql.indexOf(`function public.${name}(`)));

describe('a sale whose stock did not move', () => {
  it('is marked on the order, not only logged', () => {
    const trigger = fn('apply_stock_on_payment');
    expect(trigger).toMatch(/exception when others then\s+NEW\.stock_error := left\(sqlerrm, 300\);/);
    expect(trigger).toMatch(/NEW\.stock_applied := true;\s+NEW\.stock_error := null;/);
  });

  it('can be tried again, once, by the owner only', () => {
    const retry = fn('retry_order_stock');
    expect(retry).toMatch(/get_my_company_id\(\)/);
    expect(retry).toMatch(/for update/);
    expect(retry).toMatch(/if o\.status <> 'ödənilib' or o\.stock_applied then/);
    expect(sql).toMatch(/revoke execute on function public\.retry_order_stock\(text\) from public, anon;/);
    expect(sql).toMatch(/revoke execute on function public\.take_order_stock\(text, uuid, text\) from public, anon, authenticated;/);
  });

  it('takes order ids as text, as the orders table stores them', () => {
    expect(sql).toMatch(/take_order_stock\(p_order_id text,/);
    expect(sql).toMatch(/retry_order_stock\(p_order_id text\)/);
  });

  it('shows in Anbar with a retry button', () => {
    expect(panel).toMatch(/<StockFailures flash=\{flash\} fail=\{fail\} \/>/);
    expect(panel).toMatch(/await retryOrderStock\(id\)/);
  });
});

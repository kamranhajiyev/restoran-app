// 2026-10-08: company_order_counters had no row level security, so anyone with
// the public key could reset a company's order numbers. Locking it alone broke
// numbering — the trigger ran as the person inserting the order — so the
// trigger must run as its owner in the same migration.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('the order counter table', () => {
  const sql = readFileSync('supabase/migrations/20261008_lock_order_counters.sql', 'utf8');

  it('is closed to the public key, with the trigger still able to number orders', () => {
    expect(sql).toMatch(/alter function public\.assign_order_number\(\) security definer set search_path = public/);
    expect(sql).toMatch(/company_order_counters enable row level security/);
    expect(sql).toMatch(/revoke all on public\.company_order_counters from anon, authenticated/);
  });
});

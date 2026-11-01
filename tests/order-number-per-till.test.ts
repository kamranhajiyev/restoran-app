// 2026-11-01: production refused №45/2 when till 1 already had №45, and testing
// had no rule at all, so tests ran on a database unlike production. Now a
// number is unique per till (null and till 1 both show a plain №45).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20261106_order_number_per_till.sql', 'utf8');
const route = readFileSync('app/api/add-order/route.ts', 'utf8');

describe('the order-number rule', () => {
  it('is per till, with no till and till 1 counted as one', () => {
    expect(sql).toMatch(/create unique index if not exists (\w+)\s+on public\.orders \(company_id, order_number, coalesce\(till_number, 1\)\);/);
  });

  it('replaces the old one-number-per-restaurant rule', () => {
    expect(sql).toMatch(/drop index if exists public\.orders_company_order_number_unique;/);
  });

  it('is still caught by add-order, which renumbers a clash instead of losing the order', () => {
    const name = sql.match(/create unique index if not exists (\w+)\s+on public\.orders/)![1];
    const clash = route.match(/if \(orderError && (\/[^/]+\/i)\.test\(orderError\.message\)\) \{\s+\(\{ error: orderError \} = await insertOrder\(false\)\);/)![1];
    const re = new RegExp(clash.slice(1, -2), 'i');
    expect(re.test(`duplicate key value violates unique constraint "${name}"`)).toBe(true);
  });
});

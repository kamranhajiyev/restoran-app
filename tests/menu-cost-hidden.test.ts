// 2026-10-08: the public QR menu sent each dish's cost price to every guest.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('the public menu', () => {
  it('never sends the cost price', () => {
    const sql = readFileSync('supabase/migrations/20261008_hide_cost_price.sql', 'utf8');
    const select = sql.slice(sql.indexOf('  select'));
    expect(select).not.toMatch(/cost_price/);
    expect(readFileSync('app/[slug]/menu/page.tsx', 'utf8')).not.toMatch(/cost_price/);
  });
});

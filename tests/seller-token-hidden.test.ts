// 2026-10-08: companies.seller_token — the till link — was readable through the
// public anon key for every active restaurant, which opened their orders and
// customers and let anyone post sales. The browser must never read it; the
// owner's admin gets it from the server.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('the till link', () => {
  it('is left out of what the browser may read', () => {
    const sql = readFileSync('supabase/migrations/20261008_hide_seller_token.sql', 'utf8');
    expect(sql).toMatch(/revoke select on public\.companies from anon, authenticated/);
    const grant = sql.slice(sql.indexOf('grant select'));
    expect(grant).not.toMatch(/seller_token/);
  });

  it('is never read from the browser, and companies are never read with *', () => {
    const store = readFileSync('lib/store.ts', 'utf8');
    expect(store).not.toMatch(/from\('companies'\)\.select\('[^']*seller_token/);
    expect(store).not.toMatch(/from\('companies'\)\.select\('\*'\)/);
  });
});

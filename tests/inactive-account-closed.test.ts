// Code review, 2026-10-08: deactivating an account, or switching a restaurant
// off, only logged the screen out. The database and the server routes still
// took the old token, so a fired employee or a restaurant that stopped paying
// could go on reading and changing orders.

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sql = readFileSync('supabase/migrations/20261010_inactive_accounts_closed.sql', 'utf8');

describe('the database', () => {
  it('finds no company for an account or a restaurant that is off', () => {
    const fn = sql.slice(sql.indexOf('function public.get_my_company_id()'), sql.indexOf('function public.is_superadmin()'));
    expect(fn).toMatch(/p\.active/);
    expect(fn).toMatch(/c\.active/);
    expect(fn).toMatch(/c\.trashed_at is null/);
    expect(sql).toMatch(/role = 'superadmin' and active/);
  });

  it('closes every owner function that looks the company up itself', () => {
    const pattern = sql.match(/pattern constant text :=\s*'([^']+)'/)![1]
      .replace(/\(\?!.*\)$/, '');   // the guard against rewriting twice
    const re = new RegExp(pattern, 'i');
    // The shapes found in the database on 2026-10-08.
    for (const body of [
      "select company_id into cid from profiles where id = auth.uid() and role = 'owner';",
      "where id = (select company_id from public.profiles where id = auth.uid());",
      "where id = (select company_id from public.profiles\n                where id = auth.uid() and role = 'owner');",
      "WHERE id = (SELECT company_id FROM profiles WHERE id = auth.uid() AND role = 'owner');",
    ]) expect(re.test(body), body).toBe(true);
    expect(sql).toMatch(/raise exception 'a function still finds the company/);
  });
});

const profile = { role: 'owner', company_id: 'c1', active: true };
let company: { active: boolean; trashed_at: string | null } | null;

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        single: async () => ({ data: table === 'profiles' ? profile : company, error: null }),
        maybeSingle: async () => ({ data: table === 'profiles' ? profile : company, error: null }),
      };
      return q;
    },
  }),
}));

describe('the server routes', () => {
  const req = () => new Request('http://x', { headers: { authorization: 'Bearer t' } });
  beforeEach(() => { company = { active: true, trashed_at: null }; });

  it('let a working restaurant in', async () => {
    const { requireAuth } = await import('@/lib/supabase-server');
    expect(await requireAuth(req())).toEqual({ id: 'u1', role: 'owner', companyId: 'c1' });
  });

  it('refuse a restaurant switched off or trashed', async () => {
    const { requireAuth } = await import('@/lib/supabase-server');
    company = { active: false, trashed_at: null };
    expect((await requireAuth(req()) as Response).status).toBe(403);
    company = { active: true, trashed_at: '2026-10-08' };
    expect((await requireAuth(req()) as Response).status).toBe(403);
  });
});

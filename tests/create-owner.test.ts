// The owner login made by npm run create-owner: the same rows superadmin makes,
// and nothing half-made left behind when it is refused or fails.

import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createOwner } from '@/lib/create-owner';

type Profile = { id: string; username: string; role: string; company_id: string | null };

function fakeDb(opts: { profiles?: Profile[]; profileInsertError?: string; readError?: string } = {}) {
  const profiles = [...(opts.profiles ?? [])];
  const authUsers: { id: string; email: string }[] = [];
  const companies = [{ id: 'co-1', name: 'Odessa Döner', slug: 'odessa-doner' }];

  const query = (table: string) => {
    const filters: [string, unknown][] = [];
    const rows = () => (table === 'companies' ? companies : profiles)
      .filter(r => filters.every(([k, v]) => (r as Record<string, unknown>)[k] === v));
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (r: unknown) => void) =>
        resolve(opts.readError ? { data: null, error: { message: opts.readError } } : { data: rows(), error: null }),
      insert: async (row: Profile) => {
        if (opts.profileInsertError) return { error: { message: opts.profileInsertError } };
        profiles.push(row);
        return { error: null };
      },
    };
    return q;
  };

  const db = {
    from: query,
    auth: { admin: {
      createUser: async ({ email }: { email: string }) => {
        const user = { id: `u-${authUsers.length + 1}`, email };
        authUsers.push(user);
        return { data: { user }, error: null };
      },
      deleteUser: async (id: string) => { authUsers.splice(authUsers.findIndex(u => u.id === id), 1); return { error: null }; },
    } },
  } as unknown as SupabaseClient;
  return { db, profiles, authUsers };
}

const input = { slug: 'odessa-doner', username: 'odessadoner', password: 'Odessa1234' };

describe('createOwner', () => {
  it('makes the login and an owner profile in the company, like superadmin does', async () => {
    const { db, profiles, authUsers } = fakeDb();
    expect(await createOwner(db, input)).toEqual({ userId: 'u-1', companyName: 'Odessa Döner' });
    expect(authUsers).toEqual([{ id: 'u-1', email: 'odessadoner@restoran.internal' }]);
    expect(profiles).toEqual([expect.objectContaining({ id: 'u-1', username: 'odessadoner', role: 'owner', company_id: 'co-1' })]);
  });

  it('refuses a company that already has an owner, a taken name, a bad name or an unknown company', async () => {
    const owner = { id: 'x', username: 'boss', role: 'owner', company_id: 'co-1' };
    const elsewhere = { id: 'y', username: 'odessadoner', role: 'cashier', company_id: 'co-2' };
    for (const [setup, change, why] of [
      [{ profiles: [owner] }, {}, /already has an owner: boss/],
      [{ profiles: [elsewhere] }, {}, /taken/],
      [{}, { username: 'odessa döner' }, /Username/],
      [{}, { password: '123' }, /Password/],
      [{}, { slug: 'nope' }, /No company/],
    ] as const) {
      const { db, authUsers } = fakeDb(setup);
      const r = await createOwner(db, { ...input, ...change });
      expect(r).toEqual({ error: expect.stringMatching(why) });
      expect(authUsers).toEqual([]);
    }
  });

  it('stops on a failed read instead of taking it as "no owner yet"', async () => {
    const { db, authUsers } = fakeDb({ readError: 'timeout' });
    expect(await createOwner(db, input)).toEqual({ error: expect.stringMatching(/read failed/) });
    expect(authUsers).toEqual([]);
  });

  it('takes the login back out when its profile cannot be saved', async () => {
    const { db, authUsers, profiles } = fakeDb({ profileInsertError: 'duplicate key' });
    expect(await createOwner(db, input)).toEqual({ error: expect.stringMatching(/taken back out/) });
    expect(authUsers).toEqual([]);
    expect(profiles).toEqual([]);
  });
});

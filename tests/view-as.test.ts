// "Bax" on /superadmin opens a restaurant's admin as its owner, with a real
// login. Only an active owner of a live restaurant, every visit logged before
// the login code exists, and the way back restores the superadmin or logs out
// this device only, never the owner's own tills.

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { mintViewAs } from '@/lib/view-as';

const setSession = vi.fn();
const signOut = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      setSession: (...a: unknown[]) => setSession(...a),
      signOut: (...a: unknown[]) => signOut(...a),
    },
  },
}));

type Profile = { id: string; name: string; role: string; active: boolean; company_id: string };

function fakeDb(opts: { company?: Record<string, unknown> | null; profiles?: Profile[]; logError?: string } = {}) {
  const company = opts.company === undefined ? { id: 'co-1', name: 'Latte Art', active: true, trashed_at: null } : opts.company;
  const profiles = opts.profiles ?? [{ id: 'own-1', name: 'Natiq', role: 'owner', active: true, company_id: 'co-1' }];
  const events: unknown[] = [];
  const links: string[] = [];

  const from = (table: string) => {
    const filters: [string, unknown][] = [];
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
      maybeSingle: async () => ({ data: table === 'companies' && company && company.id === filters[0]?.[1] ? company : null, error: null }),
      then: (resolve: (r: unknown) => void) => resolve({
        data: profiles.filter(p => filters.every(([k, v]) => (p as Record<string, unknown>)[k] === v)),
        error: null,
      }),
      insert: async (row: unknown) => {
        if (opts.logError) return { error: { message: opts.logError } };
        events.push(row);
        return { error: null };
      },
    };
    return q;
  };

  const db = {
    from,
    auth: { admin: {
      getUserById: async (id: string) => ({ data: { user: { id, email: 'natiq@restoran.internal' } }, error: null }),
      generateLink: async ({ email }: { email: string }) => {
        links.push(email);
        return { data: { properties: { hashed_token: 'hash-1' } }, error: null };
      },
    } },
  } as unknown as SupabaseClient;
  return { db, events, links };
}

const meta = { ip: '1.2.3.4', userAgent: 'test' };

describe('mintViewAs', () => {
  it('gives a login code for the owner and logs the visit', async () => {
    const { db, events, links } = fakeDb();
    expect(await mintViewAs(db, 'sa-1', 'co-1', meta)).toEqual({ tokenHash: 'hash-1', ownerName: 'Natiq', companyName: 'Latte Art' });
    expect(links).toEqual(['natiq@restoran.internal']);
    expect(events).toEqual([{ superadmin_id: 'sa-1', owner_id: 'own-1', company_id: 'co-1', ip: '1.2.3.4', user_agent: 'test' }]);
  });

  it('refuses a switched-off or missing restaurant, and one with no active owner', async () => {
    for (const setup of [
      { company: { id: 'co-1', name: 'X', active: false, trashed_at: null } },
      { company: { id: 'co-1', name: 'X', active: true, trashed_at: '2026-10-30' } },
      { company: null },
      { profiles: [] },
      { profiles: [{ id: 'own-1', name: 'Natiq', role: 'owner', active: false, company_id: 'co-1' }] },
      { profiles: [{ id: 'c-1', name: 'Kassir', role: 'seller', active: true, company_id: 'co-1' }] },
    ]) {
      const { db, events, links } = fakeDb(setup);
      expect(await mintViewAs(db, 'sa-1', 'co-1', meta)).toHaveProperty('error');
      expect(links).toEqual([]);
      expect(events).toEqual([]);
    }
  });

  it('makes no login code when the visit cannot be logged', async () => {
    const { db, links } = fakeDb({ logError: 'down' });
    expect(await mintViewAs(db, 'sa-1', 'co-1', meta)).toEqual({ error: 'down', status: 500 });
    expect(links).toEqual([]);
  });
});

describe('the route', () => {
  it('is for the superadmin only', () => {
    const src = readFileSync('app/api/view-as/route.ts', 'utf8');
    expect(src).toMatch(/await requireSuperadmin\(req\)/);
  });
});

describe('the way back', () => {
  function storage() {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => { data.set(k, v); },
      removeItem: (k: string) => { data.delete(k); },
    };
  }
  const superadmin = { id: 'sa-1', name: 'S', role: 'superadmin', companyId: null, companyName: null, expiresAt: null, stationId: null };
  const visit = JSON.stringify({ accessToken: 'a', refreshToken: 'r', session: superadmin, label: 'Latte Art · Natiq' });

  beforeEach(() => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', storage());
    setSession.mockReset();
    signOut.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('puts the superadmin back and ends the visit', async () => {
    const { backToSuperadmin, viewAsLabel } = await import('@/lib/view-as-session');
    const { getSession } = await import('@/lib/auth');
    localStorage.setItem('restoran_view_as', visit);
    localStorage.setItem('restoran_auth', JSON.stringify({ ...superadmin, id: 'own-1', role: 'owner' }));
    setSession.mockResolvedValue({ error: null });

    expect(viewAsLabel()).toBe('Latte Art · Natiq');
    expect(await backToSuperadmin()).toBe(true);
    expect(setSession).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'r' });
    expect(getSession()).toEqual(superadmin);
    expect(viewAsLabel()).toBeNull();
  });

  it('logs out this device only when the superadmin login cannot come back', async () => {
    const { backToSuperadmin, viewAsLabel } = await import('@/lib/view-as-session');
    localStorage.setItem('restoran_view_as', visit);
    setSession.mockResolvedValue({ error: { message: 'expired' } });

    expect(await backToSuperadmin()).toBe(false);
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(viewAsLabel()).toBeNull();
  });

  it('Çıxış during a visit forgets the saved superadmin login', async () => {
    const { logout } = await import('@/lib/auth');
    localStorage.setItem('restoran_view_as', visit);
    logout();
    expect(localStorage.getItem('restoran_view_as')).toBeNull();
  });
});

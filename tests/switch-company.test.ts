// One owner, several məkans (20261104_company_groups.sql). The main məkan's
// owner logs in once and switches between the məkans inside it; each switch is
// a one-time login as that məkan's owner, on this device only. A child's own
// login (handed to its manager) sees no other məkan, and nobody reaches a
// company outside their own group.

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { mintSwitch, venuesFor } from '@/lib/switch-company';

type Company = { id: string; name: string; active: boolean; trashed_at: string | null; expires_at: string | null; parent_id: string | null };
type Profile = { id: string; role: string; active: boolean; company_id: string };

const co = (id: string, name: string, parent_id: string | null = null, extra: Partial<Company> = {}): Company =>
  ({ id, name, active: true, trashed_at: null, expires_at: null, parent_id, ...extra });

function fakeDb(companies: Company[], profiles: Profile[]) {
  const links: string[] = [];
  const from = (table: string) => {
    const filters: [string, unknown][] = [];
    const rows = () => (table === 'companies' ? companies : profiles)
      .filter(r => filters.every(([k, v]) => (r as Record<string, unknown>)[k] === v));
    const q = {
      select: () => q,
      order: () => q,
      eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (r: unknown) => void) => resolve({ data: rows(), error: null }),
    };
    return q;
  };
  const db = {
    from,
    auth: { admin: {
      getUserById: async (id: string) => ({ data: { user: { id, email: `${id}@restoran.internal` } }, error: null }),
      generateLink: async ({ email }: { email: string }) => {
        links.push(email);
        return { data: { properties: { hashed_token: 'hash-1' } }, error: null };
      },
    } },
  } as unknown as SupabaseClient;
  return { db, links };
}

const group = () => fakeDb(
  [co('main', 'Kamran'), co('a', 'A', 'main'), co('b', 'B', 'main'), co('other', 'Başqa')],
  [
    { id: 'boss', role: 'owner', active: true, company_id: 'main' },
    { id: 'own-a', role: 'owner', active: true, company_id: 'a' },
    { id: 'own-b', role: 'owner', active: true, company_id: 'b' },
    { id: 'own-other', role: 'owner', active: true, company_id: 'other' },
    { id: 'cashier', role: 'seller', active: true, company_id: 'main' },
  ],
);

describe('the məkans a login can open', () => {
  it('main owner: the main məkan first, then the ones inside it, nothing else', async () => {
    const r = await venuesFor(group().db, 'boss');
    expect(r).toEqual({ venues: [{ id: 'main', name: 'Kamran' }, { id: 'a', name: 'A' }, { id: 'b', name: 'B' }] });
  });

  it("a child's own login, a cashier and a lone owner get no list", async () => {
    for (const who of ['own-a', 'cashier', 'own-other']) {
      expect(await venuesFor(group().db, who)).toEqual({ venues: [] });
    }
  });

  it('a switched-off or expired child is left out', async () => {
    const { db } = fakeDb(
      [co('main', 'Kamran'), co('a', 'A', 'main', { active: false }), co('b', 'B', 'main', { expires_at: '2020-01-01' }), co('c', 'C', 'main')],
      [{ id: 'boss', role: 'owner', active: true, company_id: 'main' }],
    );
    expect(await venuesFor(db, 'boss')).toEqual({ venues: [{ id: 'main', name: 'Kamran' }, { id: 'c', name: 'C' }] });
  });
});

describe('switching', () => {
  it("main owner gets a login code for the child's owner", async () => {
    const { db, links } = group();
    expect(await mintSwitch(db, 'boss', 'b')).toEqual({ tokenHash: 'hash-1', companyName: 'B' });
    expect(links).toEqual(['own-b@restoran.internal']);
  });

  it('refuses a company outside the group, a child login, and a cashier, before any code exists', async () => {
    const { db, links } = group();
    expect(await mintSwitch(db, 'boss', 'other')).toMatchObject({ status: 403 });
    expect(await mintSwitch(db, 'own-a', 'b')).toMatchObject({ status: 403 });
    expect(await mintSwitch(db, 'own-a', 'main')).toMatchObject({ status: 403 });
    expect(await mintSwitch(db, 'cashier', 'a')).toMatchObject({ status: 403 });
    expect(links).toEqual([]);
  });

  it('refuses a switched-off child, a child with no active owner, and a switched-off main', async () => {
    const off = fakeDb([co('main', 'K'), co('a', 'A', 'main', { trashed_at: '2026-11-01' })], [{ id: 'boss', role: 'owner', active: true, company_id: 'main' }]);
    expect(await mintSwitch(off.db, 'boss', 'a')).toMatchObject({ error: 'Məkan deaktivdir' });

    const noOwner = fakeDb([co('main', 'K'), co('a', 'A', 'main')], [
      { id: 'boss', role: 'owner', active: true, company_id: 'main' },
      { id: 'own-a', role: 'owner', active: false, company_id: 'a' },
    ]);
    expect(await mintSwitch(noOwner.db, 'boss', 'a')).toMatchObject({ error: 'Bu məkanın admin hesabı yoxdur' });

    const mainOff = fakeDb([co('main', 'K', null, { active: false }), co('a', 'A', 'main')], [
      { id: 'boss', role: 'owner', active: true, company_id: 'main' },
      { id: 'own-a', role: 'owner', active: true, company_id: 'a' },
    ]);
    expect(await mintSwitch(mainOff.db, 'boss', 'a')).toMatchObject({ status: 403 });
    expect([...off.links, ...noOwner.links, ...mainOff.links]).toEqual([]);
  });
});

// The browser half, with supabase faked.
const auth = {
  getSession: vi.fn(),
  setSession: vi.fn(),
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
  signInWithPassword: vi.fn(),
};
const profiles: Record<string, { name: string; role: string; company_id: string; active: boolean; station_id: null }> = {
  boss: { name: 'Kamran', role: 'owner', company_id: 'main', active: true, station_id: null },
  'own-b': { name: 'B admin', role: 'owner', company_id: 'b', active: true, station_id: null },
  stranger: { name: 'Başqa', role: 'owner', company_id: 'other', active: true, station_id: null },
};
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...a: unknown[]) => auth.getSession(...a),
      setSession: (...a: unknown[]) => auth.setSession(...a),
      verifyOtp: (...a: unknown[]) => auth.verifyOtp(...a),
      signOut: (...a: unknown[]) => auth.signOut(...a),
      signInWithPassword: (...a: unknown[]) => auth.signInWithPassword(...a),
    },
    from: (table: string) => {
      let id = '';
      const q = {
        select: () => q,
        eq: (_k: string, v: string) => { id = v; return q; },
        single: async () => ({ data: table === 'profiles' ? profiles[id] : { name: id.toUpperCase(), expires_at: null, active: true, trashed_at: null }, error: null }),
      };
      return q;
    },
  },
}));

describe('the browser switch', () => {
  const store = new Map<string, string>();
  const fetchMock = vi.fn();

  beforeEach(async () => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
    vi.stubGlobal('window', {});
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    Object.values(auth).forEach(f => f.mockReset());
    const { putSession } = await import('@/lib/auth');
    putSession({ id: 'boss', name: 'Kamran', role: 'owner', companyId: 'main', companyName: 'Kamran', expiresAt: null, stationId: null });
  });
  afterEach(() => vi.unstubAllGlobals());

  const venues = [{ id: 'main', name: 'Kamran' }, { id: 'b', name: 'B' }];

  it('signs in as B, keeps the main login aside, and goes back to it', async () => {
    const { switchVenue, isSwitching } = await import('@/lib/switch-company-session');
    const { getSession, HOME_KEY } = await import('@/lib/auth');
    auth.getSession.mockResolvedValue({ data: { session: { access_token: 'main-at', refresh_token: 'main-rt' } } });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ tokenHash: 'h', companyName: 'B' }) });
    auth.verifyOtp.mockResolvedValue({ data: { user: { id: 'own-b' }, session: { access_token: 'b-at' } }, error: null });

    expect(await switchVenue('b', venues)).toEqual({ error: null, moved: true });
    expect(getSession()?.companyId).toBe('b');
    expect(JSON.parse(store.get(HOME_KEY)!).refreshToken).toBe('main-rt');
    // The page must not log itself out while its login changes on purpose.
    expect(isSwitching()).toBe(true);

    auth.setSession.mockResolvedValue({ data: { session: { access_token: 'main-at2', refresh_token: 'main-rt2' } }, error: null });
    expect(await switchVenue('main', venues)).toEqual({ error: null, moved: true });
    expect(auth.setSession).toHaveBeenCalledWith({ access_token: 'main-at', refresh_token: 'main-rt' });
    expect(getSession()?.companyId).toBe('main');
    expect(store.has(HOME_KEY)).toBe(false);
  });

  it('a refused switch leaves this device as it was', async () => {
    const { switchVenue, isSwitching } = await import('@/lib/switch-company-session');
    const { getSession, HOME_KEY } = await import('@/lib/auth');
    auth.getSession.mockResolvedValue({ data: { session: { access_token: 'main-at', refresh_token: 'main-rt' } } });
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Bu məkan sizin deyil' }) });

    expect(await switchVenue('b', venues)).toEqual({ error: 'Bu məkan sizin deyil', moved: false });
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(getSession()?.companyId).toBe('main');
    expect(store.has(HOME_KEY)).toBe(false);
    expect(isSwitching()).toBe(false);
    // ...and another tab's logout clears the login as usual.
    const { clearLocalSession } = await import('@/lib/auth');
    clearLocalSession();
    expect(getSession()).toBeNull();
  });

  it('the exe and the Android app show no switch', async () => {
    vi.stubGlobal('window', { posNative: { isDesktop: true } });
    const { loadVenues } = await import('@/lib/switch-company-session');
    expect(await loadVenues()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // 2026-11-01 review: the kept main login outlived a new login on the same
  // device, and its məkan menu let the next account sign in as the main owner.
  it('a new login on the device drops the kept main login', async () => {
    const { login, HOME_KEY } = await import('@/lib/auth');
    store.set(HOME_KEY, JSON.stringify({ accessToken: 'main-at', refreshToken: 'main-rt', session: {}, venues }));
    auth.signInWithPassword.mockResolvedValue({ data: { user: { id: 'stranger' }, session: null }, error: null });
    expect('session' in await login('baska', 'pw')).toBe(true);
    expect(store.has(HOME_KEY)).toBe(false);
  });

  it("a kept main login that is not this məkan's group is never used", async () => {
    const { putSession, HOME_KEY } = await import('@/lib/auth');
    const { loadVenues, switchVenue } = await import('@/lib/switch-company-session');
    putSession({ id: 'stranger', name: 'Başqa', role: 'owner', companyId: 'other', companyName: 'Başqa', expiresAt: null, stationId: null });
    store.set(HOME_KEY, JSON.stringify({ accessToken: 'main-at', refreshToken: 'main-rt', session: { companyId: 'main' }, venues }));
    auth.getSession.mockResolvedValue({ data: { session: { access_token: 'x-at', refresh_token: 'x-rt' } } });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ venues: [] }) });

    expect(await loadVenues()).toEqual([]);
    expect(store.has(HOME_KEY)).toBe(false);

    store.set(HOME_KEY, JSON.stringify({ accessToken: 'main-at', refreshToken: 'main-rt', session: { companyId: 'main' }, venues }));
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Keçid yalnız əsas məkanın hesabından olur' }) });
    expect((await switchVenue('main', venues)).moved).toBe(false);
    expect(auth.setSession).not.toHaveBeenCalled();
  });

  // A till open in another tab sees the login change and logs itself out; it
  // used to wipe the shared saved login too, and the switching tab landed on
  // /login as well.
  it("another tab's logout during a switch leaves the new login in place", async () => {
    const { switchVenue } = await import('@/lib/switch-company-session');
    const { clearLocalSession, getSession, HOME_KEY } = await import('@/lib/auth');
    auth.getSession.mockResolvedValue({ data: { session: { access_token: 'main-at', refresh_token: 'main-rt' } } });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ tokenHash: 'h', companyName: 'B' }) });
    auth.verifyOtp.mockResolvedValue({ data: { user: { id: 'own-b' }, session: { access_token: 'b-at' } }, error: null });
    await switchVenue('b', venues);

    clearLocalSession();
    expect(getSession()?.companyId).toBe('b');
    expect(store.has(HOME_KEY)).toBe(true);
  });

  it('with no switch, a logout in another tab still clears the saved login', async () => {
    const { clearLocalSession, getSession } = await import('@/lib/auth');
    clearLocalSession();
    expect(getSession()).toBeNull();
  });

  it('logging out drops the kept main login', async () => {
    const { logout, clearLocalSession, HOME_KEY } = await import('@/lib/auth');
    store.set(HOME_KEY, '{}');
    logout();
    expect(store.has(HOME_KEY)).toBe(false);
    store.set(HOME_KEY, '{}');
    clearLocalSession();
    expect(store.has(HOME_KEY)).toBe(false);
  });
});

describe('wiring', () => {
  it('the admin page ignores its own switch, and only the superadmin sets the main məkan', () => {
    const admin = readFileSync('app/admin/page.tsx', 'utf8');
    expect(admin).toMatch(/if \(isSwitching\(\)\) return;\s*if \(!s \|\| s\.user\.id !== session\.id\)/);
    expect(admin).toMatch(/<VenueSwitcher /);
    // On a phone the header already shows the name; the switch is an icon there.
    const sw = readFileSync('components/VenueSwitcher.tsx', 'utf8');
    expect(sw).toMatch(/className="hidden sm:inline[^"]*">\{current\?\.name/);
    // ...and its list spans the screen there instead of running off the left.
    expect(sw).toMatch(/className="fixed left-4 right-4 top-16 sm:absolute/);
    const sql = readFileSync('supabase/migrations/20261104_company_groups.sql', 'utf8');
    expect(sql).toMatch(/parent_id uuid references public\.companies\(id\) on delete set null/);
    expect(sql).toMatch(/Bu şirkət özü başqa şirkətin içindədir/);
    expect(sql).not.toMatch(/grant .* to anon/i);
    // companies is granted column by column: an ungranted column broke the whole list.
    expect(sql).toMatch(/grant select \(parent_id\) on public\.companies to authenticated/);
  });
});

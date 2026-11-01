// What only the superadmin may do, for real, on "restoran testing": change a
// restaurant's row (switch it off, its date, its group), and "Bax" (view-as),
// which opens a live restaurant's admin as its owner and is logged before the
// login code exists, and the nightly health report. Also Girişlər: a login is
// recorded by the server with the name it was made under, and an owner sees
// only their own restaurant's.
//
// The superadmin login is made for the run and deleted after it. Changes go to
// autotest-b and are put back; the logins this test records are removed.

import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as viewAs } from '@/app/api/view-as/route';
import { GET as loginEventsList, POST as loginEvent } from '@/app/api/login-events/route';
import { admin, anon, companyA, companyB, ownerA, ownerB, sellerA } from './setup';

const AGENT = `autotest-${randomUUID()}`;
const SUPER = 'autotest-superadmin';
let superadmin: SupabaseClient;
let superId = '';
let ownerBId = '';

const bearer = async (who: SupabaseClient) => `Bearer ${(await who.auth.getSession()).data.session!.access_token}`;

async function bax(who: SupabaseClient | null, companyId: string) {
  const res = await viewAs(new NextRequest('http://localhost/api/view-as', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'user-agent': AGENT, ...(who ? { Authorization: await bearer(who) } : {}) },
    body: JSON.stringify({ companyId }),
  }));
  return { status: res.status, body: await res.json() };
}

const visits = async () =>
  (await admin.from('view_as_events').select('owner_id, company_id').eq('superadmin_id', superId)).data ?? [];

async function removeSuperadmin() {
  const { data } = await admin.from('profiles').select('id').eq('username', SUPER).maybeSingle();
  if (!data) return;
  await admin.from('view_as_events').delete().eq('superadmin_id', data.id);
  await admin.from('login_events').delete().eq('user_id', data.id);
  await admin.from('profiles').delete().eq('id', data.id);
  await admin.auth.admin.deleteUser(data.id);
}

beforeAll(async () => {
  await removeSuperadmin();
  const email = `${SUPER}@restoran.internal`;
  const password = randomUUID();
  const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (made.error) throw new Error(made.error.message);
  superId = made.data.user!.id;
  const p = await admin.from('profiles').insert({ id: superId, username: SUPER, name: SUPER, role: 'superadmin', company_id: null, station_id: null });
  if (p.error) throw new Error(p.error.message);
  superadmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const signIn = await superadmin.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(signIn.error.message);
  ownerBId = (await ownerB.auth.getUser()).data.user!.id;
  await admin.from('companies').update({ active: true, trashed_at: null }).eq('id', companyB.id);
});

afterAll(async () => {
  await admin.from('companies').update({ active: true, trashed_at: null, parent_id: null }).eq('id', companyB.id);
  await admin.from('login_events').delete().eq('user_agent', AGENT);
  await removeSuperadmin();
});

describe("a restaurant's own row", () => {
  it('is never changed by its owner, its seller or a stranger', async () => {
    const before = (await admin.from('companies').select('name, active, expires_at, parent_id').eq('id', companyA.id).single()).data;
    for (const who of [ownerA, sellerA, ownerB, anon]) {
      await who.from('companies').update({ active: false, expires_at: '2099-01-01', name: 'Autotest dəyişdi' }).eq('id', companyA.id);
      await who.from('companies').delete().eq('id', companyA.id);
      expect((await who.from('companies').insert({ slug: `autotest-${randomUUID().slice(0, 8)}`, name: 'Autotest yeni' })).error).not.toBeNull();
    }
    expect((await admin.from('companies').select('name, active, expires_at, parent_id').eq('id', companyA.id).single()).data).toEqual(before);
  });

  it('is changed by the superadmin', async () => {
    const { data: was } = await admin.from('companies').select('expires_at').eq('id', companyB.id).single();
    const r = await superadmin.from('companies').update({ expires_at: '2099-12-31T00:00:00Z' }).eq('id', companyB.id).select('expires_at');
    expect(r.error).toBeNull();
    expect(r.data).toHaveLength(1);
    await superadmin.from('companies').update({ expires_at: was!.expires_at }).eq('id', companyB.id);
  });

  it('joins a group one level deep only', async () => {
    const { data: branch } = await admin.from('companies').select('id').eq('parent_id', companyA.id).limit(1).maybeSingle();
    expect(branch).not.toBeNull();
    // Under a branch: two levels.
    expect((await superadmin.from('companies').update({ parent_id: branch!.id }).eq('id', companyB.id)).error).not.toBeNull();
    // A group's head under someone else: two levels too.
    expect((await superadmin.from('companies').update({ parent_id: companyB.id }).eq('id', companyA.id)).error).not.toBeNull();
    expect((await admin.from('companies').select('parent_id').eq('id', companyB.id).single()).data!.parent_id).toBeNull();
    expect((await admin.from('companies').select('parent_id').eq('id', companyA.id).single()).data!.parent_id).toBeNull();
  });
});

describe('"Bax" (view-as)', () => {
  it('is the superadmin\'s alone', async () => {
    expect((await bax(null, companyB.id)).status).toBe(401);
    for (const who of [ownerA, sellerA, ownerB]) expect((await bax(who, companyB.id)).status).toBe(403);
    expect(await visits()).toEqual([]);
  });

  it('opens the restaurant as its owner, logged first', async () => {
    const r = await bax(superadmin, companyB.id);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ownerName: 'autotest-b-owner', companyName: expect.any(String) });
    expect(await visits()).toEqual([{ owner_id: ownerBId, company_id: companyB.id }]);

    const browser = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await browser.auth.verifyOtp({ token_hash: r.body.tokenHash, type: 'magiclink' });
    expect(error).toBeNull();
    expect(data.user!.id).toBe(ownerBId);
    // The code works once.
    expect((await browser.auth.verifyOtp({ token_hash: r.body.tokenHash, type: 'magiclink' })).error).not.toBeNull();
  });

  it('is refused for a restaurant switched off, or one that does not exist, and logs nothing', async () => {
    await admin.from('companies').update({ active: false }).eq('id', companyB.id);
    expect((await bax(superadmin, companyB.id)).status).toBe(400);
    await admin.from('companies').update({ active: true }).eq('id', companyB.id);
    expect((await bax(superadmin, randomUUID())).status).toBe(404);
    expect(await visits()).toHaveLength(1);
  });

  it('visits are read by nobody but the superadmin', async () => {
    for (const who of [ownerA, ownerB, sellerA, anon]) {
      expect((await who.from('view_as_events').select('id').eq('superadmin_id', superId)).data ?? []).toEqual([]);
    }
  });
});

describe('the nightly health report', () => {
  it('is run and read by the superadmin alone', async () => {
    for (const who of [ownerA, sellerA, ownerB]) {
      expect((await who.rpc('save_health_report')).error?.message).toMatch(/superadmin_only/);
      expect((await who.from('health_reports').select('id').limit(1)).data ?? []).toEqual([]);
    }
    expect((await anon.rpc('save_health_report')).error).not.toBeNull();
    expect((await anon.from('health_reports').select('id').limit(1)).data ?? []).toEqual([]);

    const { data, error } = await superadmin.rpc('save_health_report');
    expect(error).toBeNull();
    const report = data as { id: number; problems: unknown[] };
    expect(Array.isArray(report.problems)).toBe(true);
    expect((await superadmin.from('health_reports').select('id').eq('id', report.id)).data).toHaveLength(1);
    // Taken out again: the superadmin page lists the real nights.
    await admin.from('health_reports').delete().eq('id', report.id);
  });
});

describe('Girişlər', () => {
  async function record(who: SupabaseClient) {
    const res = await loginEvent(new NextRequest('http://localhost/api/login-events', {
      method: 'POST',
      headers: { Authorization: await bearer(who), 'user-agent': AGENT, 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
    }));
    return res.status;
  }
  async function list(who: SupabaseClient) {
    const res = await loginEventsList(new NextRequest('http://localhost/api/login-events', { headers: { Authorization: await bearer(who) } }));
    return { status: res.status, body: await res.json() };
  }

  it('records a login with the name it was made under, from the server\'s view of the address', async () => {
    expect(await record(sellerA)).toBe(200);
    expect(await record(ownerB)).toBe(200);
    const { data } = await admin.from('login_events').select('company_id, ip, name, username, role').eq('user_agent', AGENT).eq('username', 'autotest-seller');
    expect(data).toEqual([{ company_id: companyA.id, ip: '203.0.113.7', name: 'autotest-seller', username: 'autotest-seller', role: 'seller' }]);
  });

  it('shows an owner their own restaurant\'s logins only; a seller none', async () => {
    const mine = await list(ownerA);
    expect(mine.status).toBe(200);
    const agents = (rows: { user_agent: string; username: string }[]) => rows.filter(r => r.user_agent === AGENT).map(r => r.username);
    expect(agents(mine.body)).toEqual(['autotest-seller']);
    expect(agents((await list(ownerB)).body)).toEqual(['autotest-b-owner']);
    expect((await list(sellerA)).status).toBe(403);
  });

  it('cannot be written or read straight from the database by a stranger', async () => {
    expect((await anon.from('login_events').select('id').eq('user_agent', AGENT)).data ?? []).toEqual([]);
    expect((await anon.from('login_events').insert({ user_id: superId, company_id: companyA.id, user_agent: AGENT })).error).not.toBeNull();
    expect((await ownerB.from('login_events').select('id').eq('user_agent', AGENT).eq('company_id', companyA.id)).data ?? []).toEqual([]);
  });
});

// Switching məkan, for real, on "restoran testing", through the route the admin
// header uses (/api/switch-company): Kamran test ucun's owner sees it and the
// məkans inside it (1 filial, 2filial) and nothing else, gets in to one of them
// as that məkan's owner, and from there sees only that məkan. A branch's own
// login, a cashier and another restaurant's owner switch nowhere. Nothing is
// left behind: the switch only signs in.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { GET as venuesRoute, POST as switchRoute } from '@/app/api/switch-company/route';
import { admin, companyA, companyB, ownerA, ownerB, sellerA } from './setup';

let children: { id: string; name: string }[] = [];
let branch: SupabaseClient;

async function bearer(who: SupabaseClient): Promise<string> {
  const { data } = await who.auth.getSession();
  return data.session!.access_token;
}

async function venues(who: SupabaseClient) {
  const res = await venuesRoute(new NextRequest('http://localhost/api/switch-company', {
    headers: { Authorization: `Bearer ${await bearer(who)}` },
  }));
  return { status: res.status, body: await res.json() };
}

async function switchTo(who: SupabaseClient, companyId: string) {
  const res = await switchRoute(new NextRequest('http://localhost/api/switch-company', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await bearer(who)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId }),
  }));
  return { status: res.status, body: await res.json() };
}

/** Whose orders this login can read: the restaurant ids among them. */
async function readsOrdersOf(who: SupabaseClient, companyIds: string[]): Promise<string[]> {
  const { data } = await who.from('orders').select('company_id').in('company_id', companyIds).limit(1000);
  return [...new Set((data ?? []).map(o => o.company_id as string))].sort();
}

beforeAll(async () => {
  const { data, error } = await admin.from('companies').select('id, name')
    .eq('parent_id', companyA.id).eq('active', true).is('trashed_at', null).order('name');
  if (error) throw error;
  children = data ?? [];
  if (children.length < 2) throw new Error('Kamran test ucun needs its two branches (1 filial, 2filial) for this test');
});

describe('switching məkan', () => {
  it("lists the main məkan first, then only the ones inside it", async () => {
    const { body } = await venues(ownerA);
    expect(body.venues.map((v: { id: string }) => v.id)).toEqual([companyA.id, ...children.map(c => c.id)]);
  });

  it("gets the main owner in to a branch, as that branch's owner", async () => {
    const target = children[0];
    const res = await switchTo(ownerA, target.id);
    expect(res.status).toBe(200);
    expect(res.body.companyName).toBe(target.name);

    branch = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await branch.auth.verifyOtp({ token_hash: res.body.tokenHash, type: 'magiclink' });
    expect(error).toBeNull();
    const { data: me } = await branch.from('profiles').select('company_id, role').eq('id', (await branch.auth.getUser()).data.user!.id).single();
    expect(me).toEqual({ company_id: target.id, role: 'owner' });
  });

  it('from a branch, sees only that branch, and switches nowhere', async () => {
    const all = [companyA.id, ...children.map(c => c.id), companyB.id];
    const seen = await readsOrdersOf(branch, all);
    expect(seen.every(id => id === children[0].id)).toBe(true);
    expect((await venues(branch)).body).toEqual({ venues: [] });
    expect((await switchTo(branch, children[1].id)).status).toBe(403);
    expect((await switchTo(branch, companyA.id)).status).toBe(403);
  });

  it("the main owner's own login still reads only the main məkan's orders", async () => {
    const seen = await readsOrdersOf(ownerA, [companyA.id, ...children.map(c => c.id)]);
    expect(seen).toEqual([companyA.id]);
  });

  it('a cashier and another restaurant\'s owner get no list and no way in', async () => {
    expect((await venues(sellerA)).body).toEqual({ venues: [] });
    expect((await venues(ownerB)).body).toEqual({ venues: [] });
    expect((await switchTo(sellerA, children[0].id)).status).toBe(403);
    expect((await switchTo(ownerB, children[0].id)).status).toBe(403);
  });

  it('refuses a restaurant outside the group', async () => {
    expect((await switchTo(ownerA, companyB.id)).status).toBe(403);
  });

  it('refuses without a login', async () => {
    const res = await venuesRoute(new NextRequest('http://localhost/api/switch-company'));
    expect(res.status).toBe(401);
  });
});

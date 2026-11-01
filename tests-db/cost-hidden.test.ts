// What a dish costs the restaurant, for real, on "restoran testing": the QR
// menu anyone can open never sends it, nor does the database to a stranger or
// another restaurant; the restaurant's own till gets it only with its link.
// "Autotest maya" (price 5, cost 2.35) stays in Kamran test ucun's Menyu →
// Autotest.

import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { GET as publicMenu } from '@/app/api/public-menu/route';
import { admin, anon, companyA, ownerA, ownerB } from './setup';

const NAME = 'Autotest maya';
let dishId = '';
let token = '';

async function tillMenu(headers: Record<string, string>) {
  const res = await publicMenu(new NextRequest(`http://localhost/api/public-menu?companyId=${companyA.id}`, { headers }));
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  const { data: company } = await admin.from('companies').select('seller_token').eq('id', companyA.id).single();
  token = company!.seller_token;
  const { data } = await admin.from('menu_items').select('id').eq('company_id', companyA.id).eq('name', NAME).maybeSingle();
  dishId = data?.id ?? (await ownerA.from('menu_items').insert({
    company_id: companyA.id, name: NAME, price: 5, category: 'Autotest', position: 0, kind: 'meal',
  }).select('id').single()).data!.id;
  const upd = await ownerA.from('menu_items').update({ price: 5, cost_price: 2.35, available: true, qr_visible: true }).eq('id', dishId);
  if (upd.error) throw new Error(upd.error.message);
});

describe('the cost price', () => {
  it('is never in the QR menu', async () => {
    const { data, error } = await anon.rpc('get_public_menu_items', { p_company_id: companyA.id });
    expect(error).toBeNull();
    const row = (data as { id: string; price: number; cost_price: number | null }[]).find(r => r.id === dishId)!;
    expect(Number(row.price)).toBe(5);
    expect(row.cost_price).toBeNull();
    expect(JSON.stringify(data)).not.toContain('2.35');
  });

  it('is never read straight from the database by a stranger or another restaurant', async () => {
    for (const who of [anon, ownerB]) {
      const { data } = await who.from('menu_items').select('cost_price').eq('id', dishId);
      expect(data ?? []).toEqual([]);
    }
  });

  it('reaches only a till with the restaurant\'s link', async () => {
    expect((await tillMenu({})).status).toBe(401);
    expect((await tillMenu({ 'x-till-token': 'wrong' })).status).toBe(403);
    const ok = await tillMenu({ 'x-till-token': token });
    expect(ok.status).toBe(200);
    expect(ok.body.items.find((i: { id: string }) => i.id === dishId).costPrice).toBe(2.35);
  });
});

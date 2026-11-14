// Az qalan mal (SHOP-MODE.md, step 6), for real, on "restoran testing": the
// owner sets a stock limit and the till's route says the product is low; a
// seller cannot set one, the public key cannot read one, and the route answers
// only a till with the restaurant's link. "Autotest az qalan" stays in Kamran
// test ucun's Menyu → Autotest; its limit is taken off after the run.

import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as publicLowStock } from '@/app/api/public-low-stock/route';
import { admin, anon, companyA, ownerA, sellerA } from './setup';

const NAME = 'Autotest az qalan';
let dishId = '';
let stockId = '';
let token = '';

async function tillLow(headers: Record<string, string>) {
  const res = await publicLowStock(new NextRequest(`http://localhost/api/public-low-stock?companyId=${companyA.id}`, { headers }));
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  const { data: company } = await admin.from('companies').select('seller_token').eq('id', companyA.id).single();
  token = company!.seller_token;
  const { data } = await admin.from('menu_items').select('id').eq('company_id', companyA.id).eq('name', NAME).maybeSingle();
  dishId = data?.id ?? (await ownerA.from('menu_items').insert({
    company_id: companyA.id, name: NAME, price: 1, category: 'Autotest', position: 0, kind: 'product',
  }).select('id').single()).data!.id;
  const link = await ownerA.rpc('link_product_stock', { p_menu_item_id: dishId, p_unit: 'ədəd' });
  if (link.error) throw new Error(link.error.message);
  const { data: line } = await admin.from('recipe_lines').select('stock_item_id')
    .eq('menu_item_id', dishId).is('variant_id', null).single();
  stockId = line!.stock_item_id;
});

afterAll(async () => {
  await admin.from('stock_items').update({ min_qty: null }).eq('id', stockId);
});

describe('a stock limit', () => {
  it('is set by the owner, never by a seller', async () => {
    await sellerA.from('stock_items').update({ min_qty: 7 }).eq('id', stockId);
    expect((await admin.from('stock_items').select('min_qty').eq('id', stockId).single()).data!.min_qty).toBeNull();
    const r = await ownerA.from('stock_items').update({ min_qty: 100000 }).eq('id', stockId).select('min_qty');
    expect(r.error).toBeNull();
    expect(Number(r.data![0].min_qty)).toBe(100000);
    expect((await ownerA.from('stock_items').update({ min_qty: -1 }).eq('id', stockId)).error).not.toBeNull();
  });

  it('is not read by the public key', async () => {
    const { data } = await anon.from('stock_items').select('min_qty').eq('id', stockId);
    expect(data ?? []).toEqual([]);
  });

  it('makes the product low on a till with the restaurant\'s link, and only there', async () => {
    expect((await tillLow({})).status).toBe(401);
    expect((await tillLow({ 'x-till-token': 'wrong' })).status).toBe(403);
    const ok = await tillLow({ 'x-till-token': token });
    expect(ok.status).toBe(200);
    expect(typeof ok.body.low[dishId]).toBe('number');
  });

  it('taken off, warns no more', async () => {
    await ownerA.from('stock_items').update({ min_qty: null }).eq('id', stockId);
    const ok = await tillLow({ 'x-till-token': token });
    expect(ok.body.low[dishId]).toBeUndefined();
  });
});

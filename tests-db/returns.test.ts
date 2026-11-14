// Qaytarma (SHOP-MODE.md, step 5), for real, on "restoran testing", through
// the till's own route: a return with a link is saved once (sent twice, saved
// once), puts the goods back into stock, and is read by nobody else — not the
// public key, not another restaurant. Uses "Autotest az qalan" (made by
// low-stock.test.ts or here) in Kamran test ucun; by card, so no shift is
// needed. Its own rows and the stock it moved are taken back after the run.
// The manager is "Autotest qaytarma menecer", made for the run with its own PIN
// and removed after; the server checks that PIN (20261114_return_approval.sql).

import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as addReturn } from '@/app/api/add-return/route';
import { admin, anon, companyA, ownerA, ownerB } from './setup';

const NAME = 'Autotest az qalan';
const MANAGER = 'Autotest qaytarma menecer';
const device = `autotest-return-${randomUUID()}`;
let pin = '';
let dishId = '';
let stockId = '';
let token = '';
let warehouse = '';
const made: string[] = [];

async function send(body: Record<string, unknown>) {
  const res = await addReturn(new NextRequest('http://localhost/api/add-return', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
}
const request = (id: string, over: Record<string, unknown> = {}) => ({
  id, orderId: null, pay: 'card', seller: 'Autotest', approvedBy: 'Typed by the till', pin, device,
  lines: [{ menuItemId: dishId, variantId: null, name: NAME, qty: 1, price: 1.5 }], ...over,
});
const stockNow = async () => Number((await admin.from('stock_balances').select('qty')
  .eq('warehouse_id', warehouse).eq('stock_item_id', stockId).maybeSingle()).data?.qty ?? 0);

beforeAll(async () => {
  const { data: company } = await admin.from('companies').select('seller_token, sales_warehouse_id').eq('id', companyA.id).single();
  token = company!.seller_token;
  warehouse = company!.sales_warehouse_id;
  const { data } = await admin.from('menu_items').select('id').eq('company_id', companyA.id).eq('name', NAME).maybeSingle();
  dishId = data?.id ?? (await ownerA.from('menu_items').insert({
    company_id: companyA.id, name: NAME, price: 1.5, category: 'Autotest', position: 0, kind: 'product',
  }).select('id').single()).data!.id;
  await ownerA.rpc('link_product_stock', { p_menu_item_id: dishId, p_unit: 'ədəd' });
  await admin.from('staff').delete().eq('company_id', companyA.id).eq('name', MANAGER);
  for (let i = 0; i < 20 && !pin; i++) {
    const p = String(Math.floor(Math.random() * 10_000)).padStart(4, '0');
    const { error } = await ownerA.rpc('create_staff', { p_name: MANAGER, p_pin: p, p_role: 'manager' });
    if (!error) pin = p; else if (!/pin_taken/.test(error.message)) throw new Error(error.message);
  }
  stockId = (await admin.from('recipe_lines').select('stock_item_id').eq('menu_item_id', dishId).is('variant_id', null).single()).data!.stock_item_id;
});

afterAll(async () => {
  for (const id of made) {
    const { data: moves } = await admin.from('stock_movements').select('id, qty, warehouse_id, stock_item_id')
      .eq('company_id', companyA.id).eq('reason', 'return').eq('note', 'Qaytarma').eq('created_by', 'Autotest');
    for (const m of moves ?? []) {
      const { data: b } = await admin.from('stock_balances').select('qty').eq('warehouse_id', m.warehouse_id).eq('stock_item_id', m.stock_item_id).single();
      await admin.from('stock_balances').update({ qty: Number(b!.qty) - Number(m.qty) }).eq('warehouse_id', m.warehouse_id).eq('stock_item_id', m.stock_item_id);
      await admin.from('stock_movements').delete().eq('id', m.id);
    }
    await admin.from('returns').delete().eq('id', id);
  }
  await admin.from('staff').delete().eq('company_id', companyA.id).eq('name', MANAGER);
  await admin.from('staff_pin_state').delete().eq('company_id', companyA.id).eq('device_id', device);
});

describe('a return through the till', () => {
  it('needs the restaurant\'s link', async () => {
    expect((await send({ companyId: companyA.id, token: 'wrong', request: request(randomUUID()) })).status).toBe(403);
  });

  it('is saved once, even sent twice, and puts the goods back into stock', async () => {
    const id = randomUUID();
    made.push(id);
    const before = await stockNow();
    const first = await send({ companyId: companyA.id, token, request: request(id) });
    expect(first).toEqual({ status: 200, body: { ok: true, total: 1.5 } });
    const again = await send({ companyId: companyA.id, token, request: request(id) });
    expect(again.status).toBe(200);
    const { data: rows } = await admin.from('returns').select('total, pay, approved_by').eq('id', id);
    // The name the server found by the PIN, not the one the till typed.
    expect(rows).toEqual([{ total: 1.5, pay: 'card', approved_by: MANAGER }]);
    expect(await stockNow()).toBe(Math.round((before + 1) * 1000) / 1000);
  });

  it('is refused without a manager\'s PIN, with a wrong one, or for a receipt that is not there', async () => {
    const noPin = await send({ companyId: companyA.id, token, request: request(randomUUID(), { pin: undefined }) });
    expect(noPin.body.error).toMatch(/not_approved/);
    const wrong = await send({ companyId: companyA.id, token, request: request(randomUUID(), { pin: pin === '0000' ? '0001' : '0000' }) });
    expect(wrong.body.error).toMatch(/not_approved|locked/);
    // A wrong PIN counts toward the lockout, as on the approval pad.
    const { data: state } = await admin.from('staff_pin_state').select('failed_attempts').eq('company_id', companyA.id).eq('device_id', device).maybeSingle();
    expect(state?.failed_attempts ?? 0).toBeGreaterThan(0);
    await admin.from('staff_pin_state').delete().eq('company_id', companyA.id).eq('device_id', device);
    const noSale = await send({ companyId: companyA.id, token, request: request(randomUUID(), { orderId: 'autotest-no-such-order' }) });
    expect(noSale.body.error).toMatch(/not_found/);
  });

  it('is read by its own restaurant only', async () => {
    const id = made[0];
    expect((await ownerA.from('returns').select('id').eq('id', id)).data).toHaveLength(1);
    for (const who of [ownerB, anon]) expect((await who.from('returns').select('id').eq('id', id)).data ?? []).toEqual([]);
    // And never written straight to the table, only through record_return().
    expect((await ownerA.from('returns').insert({ id: randomUUID(), company_id: companyA.id, total: 1, pay: 'cash' })).error).not.toBeNull();
    expect((await anon.rpc('record_return', { p_id: randomUUID(), p_order_id: null, p_lines: [], p_pay: 'cash', p_seller: 'x', p_approved_by: 'x', p_pin: pin })).error).not.toBeNull();
  });
});

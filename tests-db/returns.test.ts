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
import { POST as addOrder } from '@/app/api/add-order/route';
import { POST as payOrder } from '@/app/api/update-order-status/route';
import { GET as publicSale } from '@/app/api/public-sale/route';
import { TILL_TOKEN_HEADER } from '@/lib/till-read-token';
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
const ORDER_NOTE = 'Autotest qaytarma';
const BARE = 'Autotest qaytarma ölçülü';
let sizedId = '';

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
  // Its own sales: the returns above are gone, so nothing holds them.
  const { data: sales } = await admin.from('orders').select('id').eq('company_id', companyA.id).eq('note', ORDER_NOTE);
  const ids = (sales ?? []).map(o => o.id);
  if (ids.length) {
    const { data: moves } = await admin.from('stock_movements').select('id, qty, warehouse_id, stock_item_id').eq('company_id', companyA.id).in('order_id', ids);
    for (const m of moves ?? []) {
      const { data: b } = await admin.from('stock_balances').select('qty').eq('warehouse_id', m.warehouse_id).eq('stock_item_id', m.stock_item_id).single();
      await admin.from('stock_balances').update({ qty: Number(b!.qty) - Number(m.qty) }).eq('warehouse_id', m.warehouse_id).eq('stock_item_id', m.stock_item_id);
      await admin.from('stock_movements').delete().eq('id', m.id);
    }
    await admin.from('order_items').delete().in('order_id', ids);
    await admin.from('orders').delete().in('id', ids);
  }
  await admin.from('recipe_lines').delete().eq('menu_item_id', sizedId);
  await admin.from('menu_items').delete().eq('company_id', companyA.id).eq('name', BARE);
  await admin.from('couriers').delete().eq('company_id', companyA.id).eq('name', ORDER_NOTE);
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
    const saved = { status: 200, body: { ok: true, total: 1.5, approvedBy: MANAGER, lines: [{ name: NAME, qty: 1, price: 1.5 }] } };
    expect(first).toEqual(saved);
    const again = await send({ companyId: companyA.id, token, request: request(id) });
    expect(again).toEqual(saved);
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

// 2026-11-24 (20261118_return_money.sql).
describe('a return with a receipt', () => {
  type Route = (req: NextRequest) => Promise<Response>;
  async function till(route: Route, body: object) {
    const res = await route(new NextRequest('http://localhost/api', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ companyId: companyA.id, token, ...body }),
    }));
    return res.json();
  }
  type Item = { id: string; price: number; quantity: number; variantId?: string };
  async function sell(items: Item[], pay: Record<string, unknown> = {}, courierId?: string) {
    const id = randomUUID();
    const order = {
      id, orderNumber: 0, tableNumber: 0, status: 'gözləyir', note: ORDER_NOTE, createdAt: new Date().toISOString(), sellerName: 'Autotest',
      ...(courierId ? { courierId } : {}),
      items: items.map(i => ({ id: randomUUID(), menuItem: { id: i.id, name: NAME, price: i.price }, quantity: i.quantity, ...(i.variantId ? { variantId: i.variantId } : {}) })),
    };
    expect(await till(addOrder, { order })).toEqual({ ok: true });
    const gross = items.reduce((t, i) => t + i.price * i.quantity, 0);
    expect((await till(payOrder, { orderId: id, status: 'ödənilib', cashAmount: gross, cardAmount: 0, ...pay })).ok).toBe(true);
    return id;
  }
  async function giveBack(orderId: string, qty: number, over: Record<string, unknown> = {}) {
    const id = randomUUID();
    made.push(id);
    return (await send({ companyId: companyA.id, token, request: request(id, { orderId, lines: [{ menuItemId: dishId, variantId: null, name: NAME, qty, price: 99 }], ...over }) })).body;
  }

  it('is found by its number, through the till\'s own route', async () => {
    const id = await sell([{ id: dishId, price: 2, quantity: 2 }]);
    const { data } = await admin.from('orders').select('order_number').eq('id', id).single();
    const res = await publicSale(new NextRequest(`http://localhost/api/public-sale?companyId=${companyA.id}&label=${data!.order_number}`, { headers: { [TILL_TOKEN_HEADER]: token } }));
    const { sale } = await res.json();
    expect(sale).toMatchObject({ id, lines: [{ menuItemId: dishId, left: 2, price: 2 }] });
  });

  it('3 × 1.00 less 1.00: 2.00 back, all at once or one at a time', async () => {
    const pay = { cashAmount: 2, discountAmount: 1, discountType: '₼' };
    expect(await giveBack(await sell([{ id: dishId, price: 1, quantity: 3 }], pay), 3)).toMatchObject({ ok: true, total: 2 });
    const id = await sell([{ id: dishId, price: 1, quantity: 3 }], pay);
    const totals = [];
    for (let i = 0; i < 3; i++) totals.push((await giveBack(id, 1)).total);
    expect(totals).toEqual([0.67, 0.66, 0.67]);
    expect((await giveBack(id, 1)).error).toMatch(/more_than_sold/);
  });

  it('sold at 2.00 and 3.00: 5.00 back, not 6.00', async () => {
    expect(await giveBack(await sell([{ id: dishId, price: 2, quantity: 1 }, { id: dishId, price: 3, quantity: 1 }]), 2)).toMatchObject({ ok: true, total: 5 });
  });

  it('a delivery the rider has not paid for gives nothing back', async () => {
    const { data: rider } = await ownerA.from('couriers').insert({ company_id: companyA.id, name: ORDER_NOTE }).select('id').single();
    const id = await sell([{ id: dishId, price: 2, quantity: 1 }], { cashAmount: 0, courierDebt: 2 }, rider!.id);
    expect((await giveBack(id, 1)).error).toMatch(/courier_unpaid/);
  });

  it('once goods came back the sale cannot be deleted, and the stock moved once', async () => {
    const before = await stockNow();
    const id = await sell([{ id: dishId, price: 2, quantity: 1 }]);
    expect(await stockNow()).toBe(Math.round((before - 1) * 1000) / 1000);
    expect((await giveBack(id, 1)).ok).toBe(true);
    const del = await ownerA.rpc('delete_order', { p_order_id: id, p_by: 'Autotest' });
    expect(del.error?.message).toMatch(/has_returns/);
    expect(await stockNow()).toBe(before);
    // One with no returns still goes, and gives its stock back.
    const plain = await sell([{ id: dishId, price: 2, quantity: 1 }]);
    expect((await ownerA.rpc('delete_order', { p_order_id: plain, p_by: 'Autotest' })).error).toBeNull();
    expect(await stockNow()).toBe(before);
  });

  it('a size that sells by the dish\'s recipe goes back by it too', async () => {
    const size = { id: randomUUID(), name: '0.5', price: 2 };
    const { data: dish, error } = await admin.from('menu_items').insert({
      company_id: companyA.id, name: BARE, price: 2, category: 'Autotest', position: 0, kind: 'meal', variants: [size],
    }).select('id').single();
    if (error) throw new Error(error.message);
    sizedId = dish.id;
    const line = await admin.from('recipe_lines').insert({ company_id: companyA.id, menu_item_id: sizedId, stock_item_id: stockId, qty: 2 });
    if (line.error) throw new Error(line.error.message);
    const before = await stockNow();
    const id = await sell([{ id: sizedId, price: 2, quantity: 1, variantId: size.id }]);
    expect(await stockNow()).toBe(Math.round((before - 2) * 1000) / 1000);
    const lines = [{ menuItemId: sizedId, variantId: size.id, name: BARE, qty: 1, price: 2 }];
    expect((await giveBack(id, 1, { lines })).ok).toBe(true);
    expect(await stockNow()).toBe(before);
  });

  it('a cash return\'s line in Kassa cannot be changed or deleted on its own', async () => {
    const { data: open } = await admin.from('cash_shifts').select('opened_by').eq('company_id', companyA.id).is('closed_at', null);
    if (open?.some(o => o.opened_by !== ORDER_NOTE)) throw new Error('Kamran test ucun has a shift open that is not the test\'s: close it first, it is left alone');
    await admin.from('cash_shifts').delete().eq('company_id', companyA.id).eq('opened_by', ORDER_NOTE);
    const own = { id: randomUUID(), at: new Date().toISOString(), amount: -3, reason: 'Autotest məxaric', by: 'Autotest' };
    const { data: shift, error } = await admin.from('cash_shifts').insert({ company_id: companyA.id, opened_by: ORDER_NOTE, opening_cash: 50, movements: [own] }).select('id').single();
    if (error) throw new Error(error.message);
    try {
      const orderId = await sell([{ id: dishId, price: 2, quantity: 1 }]);
      expect(await giveBack(orderId, 1, { pay: 'cash' })).toMatchObject({ ok: true, total: 2 });
      const id = made[made.length - 1];
      const moves = async () => (await admin.from('cash_shifts').select('movements').eq('id', shift.id).single()).data!.movements as { id: string; amount: number }[];
      expect((await moves()).map(m => [m.id, Number(m.amount)])).toEqual([[own.id, -3], [id, -2]]);
      const change = await ownerA.rpc('update_shift_movement', { shift_id: shift.id, movement_id: id, new_amount: -1, new_reason: 'x', by_name: 'Autotest' });
      expect(change.error?.message).toMatch(/is_return/);
      expect((await ownerA.rpc('delete_shift_movement', { shift_id: shift.id, movement_id: id, by_name: 'Autotest' })).error?.message).toMatch(/is_return/);
      expect((await moves()).map(m => Number(m.amount))).toEqual([-3, -2]);
      // Any other line is the owner's to correct, as before.
      expect((await ownerA.rpc('update_shift_movement', { shift_id: shift.id, movement_id: own.id, new_amount: -4, new_reason: 'Autotest', by_name: 'Autotest' })).error).toBeNull();
      expect((await ownerA.rpc('delete_shift_movement', { shift_id: shift.id, movement_id: own.id, by_name: 'Autotest' })).error).toBeNull();
      expect((await moves()).map(m => m.id)).toEqual([id]);
    } finally {
      await admin.from('cash_shifts').delete().eq('id', shift.id).eq('opened_by', ORDER_NOTE);
    }
  });

  it('a stranger runs none of the new functions', async () => {
    for (const who of [anon, ownerA]) {
      expect((await who.rpc('return_stock_lines', { p_return_id: randomUUID(), p_company_id: companyA.id })).error).not.toBeNull();
      expect((await who.rpc('return_saved_lines', { p_return_id: randomUUID() })).error).not.toBeNull();
    }
  });
});

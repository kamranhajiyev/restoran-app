// Stock, for real, on "restoran testing": goods bought in raise the warehouse,
// a paid sale takes exactly what the recipe says from the sales warehouse
// (dishes taken off the bill take nothing), it is taken once, a deleted paid
// order puts it back, and only the owner keeps the warehouse. Kamran test ucun
// is left with "Autotest anbar" as its sales warehouse, "Autotest düyü" in it,
// and "Autotest stok plov" (0.2 kq düyü each) in Menyu → Autotest stok. Each run
// takes the last run's goods and sales out first. The restaurant's own dishes
// have no recipe, so its own sales take nothing.

import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { POST as addOrder } from '@/app/api/add-order/route';
import { POST as payOrder } from '@/app/api/update-order-status/route';
import { POST as updateQty } from '@/app/api/update-order-item-qty/route';
import { admin, anon, companyA, ownerA, ownerB, sellerA } from './setup';

const CATEGORY = 'Autotest stok';
const NOTE = 'Autotest stok';
let token = '';
let warehouseId = '';
let riceId = '';
let dishId = '';
const orderId = randomUUID();
const line = randomUUID();

type Route = (req: NextRequest) => Promise<Response>;
async function send(route: Route, body: object, key: string = randomUUID()) {
  const res = await route(new NextRequest('http://localhost/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ companyId: companyA.id, token, ...body }),
  }));
  return { status: res.status, body: await res.json() };
}

/** Rice in the sales warehouse, as the Anbar page reads it, to the gram. */
async function rice(): Promise<number> {
  const { data } = await admin.from('stock_balances').select('qty').eq('warehouse_id', warehouseId).eq('stock_item_id', riceId).maybeSingle();
  return Math.round(Number(data?.qty ?? 0) * 1000) / 1000;
}

/** One row by name, made by the owner the first time. */
async function ensure(table: string, match: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<string> {
  let q = admin.from(table).select('id');
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
  const { data } = await q.maybeSingle();
  if (data) return data.id;
  const made = await ownerA.from(table).insert({ ...match, ...extra }).select('id').single();
  if (made.error) throw new Error(`${table}: ${made.error.message}`);
  return made.data.id;
}

// Only the test's own rows: the restaurant may hold real ones.
beforeAll(async () => {
  const { data: company } = await admin.from('companies').select('seller_token').eq('id', companyA.id).single();
  token = company!.seller_token;

  warehouseId = await ensure('warehouses', { company_id: companyA.id, name: 'Autotest anbar' });
  riceId = await ensure('stock_items', { company_id: companyA.id, name: 'Autotest düyü' }, { unit: 'kq' });
  // A Yemək: only it has a recipe (a Məhsul takes itself, recipe_line_product_guard).
  dishId = await ensure('menu_items', { company_id: companyA.id, name: 'Autotest stok plov', category: CATEGORY },
    { price: 6.5, position: 0, kind: 'meal' });
  await ownerA.from('menu_items').update({ kind: 'meal' }).eq('id', dishId);
  const { data: cat } = await admin.from('categories').select('id').eq('company_id', companyA.id).eq('name', CATEGORY).maybeSingle();
  if (!cat) await ownerA.from('categories').insert({ company_id: companyA.id, name: CATEGORY });

  // Last run's sales, goods and balance.
  const { data: old } = await admin.from('orders').select('id').eq('company_id', companyA.id).eq('note', NOTE);
  const oldIds = (old ?? []).map(o => o.id);
  await admin.from('stock_movements').delete().eq('stock_item_id', riceId);
  await admin.from('stock_receipts').delete().eq('warehouse_id', warehouseId);
  await admin.from('stock_balances').delete().eq('stock_item_id', riceId);
  if (oldIds.length) {
    await admin.from('order_items').delete().in('order_id', oldIds);
    await admin.from('orders').delete().in('id', oldIds);
  }
});

describe('the warehouse', () => {
  it('is kept by the owner only', async () => {
    expect((await sellerA.from('stock_items').insert({ company_id: companyA.id, name: 'Autotest satıcı' })).error).not.toBeNull();
    expect((await sellerA.rpc('set_sales_warehouse', { p_id: warehouseId })).error).not.toBeNull();
    expect((await sellerA.rpc('record_receipt', {
      p_warehouse_id: warehouseId, p_supplier_id: null, p_lines: [{ stock_item_id: riceId, qty: 100 }], p_note: null,
    })).error).not.toBeNull();
    expect((await ownerB.rpc('record_receipt', {
      p_warehouse_id: warehouseId, p_supplier_id: null, p_lines: [{ stock_item_id: riceId, qty: 100 }], p_note: null,
    })).error).not.toBeNull();
    expect((await anon.from('stock_balances').select('qty').eq('stock_item_id', riceId)).data ?? []).toEqual([]);
    expect(await rice()).toBe(0);
  });

  it('takes the plov recipe and the sales warehouse from the owner', async () => {
    expect((await ownerA.rpc('set_sales_warehouse', { p_id: warehouseId })).error).toBeNull();
    await admin.from('recipe_lines').delete().eq('menu_item_id', dishId);
    expect((await ownerA.from('recipe_lines').insert({ company_id: companyA.id, menu_item_id: dishId, stock_item_id: riceId, qty: 0.2 })).error).toBeNull();
  });

  it('holds 10 kq once 10 kq is bought in, even when Save is pressed twice', async () => {
    const receipt = { p_id: randomUUID(), p_warehouse_id: warehouseId, p_supplier_id: null, p_lines: [{ stock_item_id: riceId, qty: 10, unit_cost: 2 }], p_note: 'Autotest' };
    expect((await ownerA.rpc('record_receipt', receipt)).error).toBeNull();
    expect((await ownerA.rpc('record_receipt', receipt)).error).toBeNull();
    expect(await rice()).toBe(10);
  });

  it('takes nothing for an order not paid yet', async () => {
    const order = {
      id: orderId, orderNumber: 0, tableNumber: 0, status: 'gözləyir', note: NOTE,
      createdAt: new Date().toISOString(), sellerName: 'autotest',
      items: [{ id: line, menuItem: { id: dishId, name: 'Autotest stok plov', price: 6.5 }, quantity: 4 }],
    };
    expect((await send(addOrder, { order })).body).toEqual({ ok: true });
    expect(await rice()).toBe(10);
  });

  it('takes 3 × 0.2 = 0.6 kq once 3 plov are paid; the one taken off takes nothing', async () => {
    expect((await send(updateQty, { orderId, orderItemId: line, quantity: 3 })).body.ok).toBe(true);
    const pay = { orderId, status: 'ödənilib', cashAmount: 19.5, cardAmount: 0 };
    expect((await send(payOrder, pay)).body.ok).toBe(true);
    expect((await send(payOrder, pay)).body.ok).toBe(false);
    expect(await rice()).toBe(9.4);
    const { data } = await admin.from('stock_movements').select('qty, reason').eq('order_id', orderId);
    expect(data!.map(m => `${m.reason} ${Number(m.qty)}`)).toEqual(['sale -0.6']);
    const { data: o } = await admin.from('orders').select('stock_applied, stock_error').eq('id', orderId).single();
    expect(o).toEqual({ stock_applied: true, stock_error: null });
  });

  it('gets the 0.6 kq back when the owner deletes the paid order', async () => {
    expect((await ownerA.from('orders').update({ status: 'silinib' }).eq('id', orderId)).error).toBeNull();
    expect(await rice()).toBe(10);
    // The sale stays in the history, undone by its own line.
    const { data } = await admin.from('stock_movements').select('qty, reason').eq('order_id', orderId).order('created_at');
    expect(data!.map(m => `${m.reason} ${Number(m.qty)}`).sort()).toEqual(['sale -0.6', 'sale_void 0.6']);
  });
});

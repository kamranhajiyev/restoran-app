// Sets, for real, on "restoran testing": "Autotest set 1" = plov qulyaj + 2
// ayran. Sold twice through the real /api/add-order, each part goes to the
// station that makes it (plov to the kitchen, 4 ayran to the bar), named with
// its size and its set; paid, it takes each part's own recipe (the qulyaj size
// takes the plov recipe), once; the owner of another restaurant cannot change
// it, and the public menu never shows what is inside a set.
//
// Run in autotest-b, which nobody uses: a real till on Kamran test ucun would
// print the tickets. Each run takes the last run's orders, tickets and stock out
// first; the dishes, the "Autotest bar" station and "Autotest set anbar" (its
// sales warehouse) stay.

import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { POST as addOrder } from '@/app/api/add-order/route';
import { POST as payOrder } from '@/app/api/update-order-status/route';
import { admin, anon, companyB, ownerA, ownerB } from './setup';

const NOTE = 'Autotest set';
const CATEGORY = 'Autotest set';
const orderId = randomUUID();
let token = '';
const ids = { kitchen: '', bar: '', warehouse: '', rice: '', yogurt: '', plov: '', ayran: '', set: '' };

type Route = (req: NextRequest) => Promise<Response>;
async function send(route: Route, body: object) {
  const res = await route(new NextRequest('http://localhost/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ companyId: companyB.id, token, ...body }),
  }));
  return { status: res.status, body: await res.json() };
}

/** One row of autotest-b by name, made by its owner the first time, then set to `fields`. */
async function ensure(table: string, name: string, fields: Record<string, unknown> = {}): Promise<string> {
  const { data } = await admin.from(table).select('id').eq('company_id', companyB.id).eq('name', name).maybeSingle();
  if (data) {
    if (Object.keys(fields).length) {
      const upd = await ownerB.from(table).update(fields).eq('id', data.id);
      if (upd.error) throw new Error(`${name}: ${upd.error.message}`);
    }
    return data.id;
  }
  const made = await ownerB.from(table).insert({ company_id: companyB.id, name, ...fields }).select('id').single();
  if (made.error) throw new Error(`${name}: ${made.error.message}`);
  return made.data.id;
}

async function stock(stockItemId: string): Promise<number> {
  const { data } = await admin.from('stock_balances').select('qty').eq('warehouse_id', ids.warehouse).eq('stock_item_id', stockItemId).maybeSingle();
  return Math.round(Number(data?.qty ?? 0) * 1000) / 1000;
}

beforeAll(async () => {
  const { data: company } = await admin.from('companies').select('seller_token').eq('id', companyB.id).single();
  token = company!.seller_token;

  ids.kitchen = await ensure('stations', 'Autotest mətbəx');
  ids.bar = await ensure('stations', 'Autotest bar');
  ids.warehouse = await ensure('warehouses', 'Autotest set anbar');
  ids.rice = await ensure('stock_items', 'Autotest set düyü', { unit: 'kq' });
  ids.yogurt = await ensure('stock_items', 'Autotest set qatıq', { unit: 'l' });
  const dish = { category: CATEGORY, position: 0, available: true };
  ids.plov = await ensure('menu_items', 'Autotest set plov', {
    ...dish, price: 10, kind: 'meal', station_id: ids.kitchen, variants: [{ id: 'q', name: 'qulyaj', price: 10 }],
  });
  ids.ayran = await ensure('menu_items', 'Autotest set ayran', { ...dish, price: 1, kind: 'meal', station_id: ids.bar, variants: null });
  ids.set = await ensure('menu_items', 'Autotest set 1', {
    ...dish, price: 12, kind: 'set', station_id: ids.kitchen,
    set_items: [{ id: ids.plov, qty: 1, variantId: 'q' }, { id: ids.ayran, qty: 2 }],
  });
  const { data: cat } = await admin.from('categories').select('id').eq('company_id', companyB.id).eq('name', CATEGORY).maybeSingle();
  if (!cat) await ownerB.from('categories').insert({ company_id: companyB.id, name: CATEGORY });

  // The plov recipe is for the whole dish (no size), as the menu form saves it.
  await admin.from('recipe_lines').delete().in('menu_item_id', [ids.plov, ids.ayran]);
  const rec = await ownerB.from('recipe_lines').insert([
    { company_id: companyB.id, menu_item_id: ids.plov, stock_item_id: ids.rice, qty: 0.2 },
    { company_id: companyB.id, menu_item_id: ids.ayran, stock_item_id: ids.yogurt, qty: 0.25 },
  ]);
  if (rec.error) throw new Error(rec.error.message);

  // Last run's orders, tickets and stock.
  const { data: old } = await admin.from('orders').select('id').eq('company_id', companyB.id).eq('note', NOTE);
  const oldIds = (old ?? []).map(o => o.id);
  if (oldIds.length) {
    await admin.from('print_jobs').delete().in('order_id', oldIds);
    await admin.from('order_items').delete().in('order_id', oldIds);
    await admin.from('orders').delete().in('id', oldIds);
  }
  await admin.from('stock_movements').delete().in('stock_item_id', [ids.rice, ids.yogurt]);
  await admin.from('stock_receipts').delete().eq('warehouse_id', ids.warehouse);
  await admin.from('stock_balances').delete().in('stock_item_id', [ids.rice, ids.yogurt]);

  const sw = await ownerB.rpc('set_sales_warehouse', { p_id: ids.warehouse });
  if (sw.error) throw new Error(sw.error.message);
  const receipt = await ownerB.rpc('record_receipt', {
    p_id: randomUUID(), p_warehouse_id: ids.warehouse, p_supplier_id: null, p_note: NOTE,
    p_lines: [{ stock_item_id: ids.rice, qty: 10, unit_cost: 1 }, { stock_item_id: ids.yogurt, qty: 10, unit_cost: 1 }],
  });
  if (receipt.error) throw new Error(receipt.error.message);
});

describe('a set', () => {
  it('sold twice sends each part to the station that makes it', async () => {
    const order = {
      id: orderId, orderNumber: 0, tableNumber: 0, status: 'gözləyir', note: NOTE,
      createdAt: new Date().toISOString(), sellerName: 'autotest',
      items: [{ id: randomUUID(), menuItem: { id: ids.set, name: 'Autotest set 1', price: 12 }, quantity: 2 }],
    };
    expect((await send(addOrder, { order })).body).toEqual({ ok: true });

    const { data: jobs } = await admin.from('print_jobs').select('station_id, kind, payload').eq('order_id', orderId);
    const at = (station: string) => (jobs ?? []).filter(j => j.station_id === station)
      .flatMap(j => (j.payload.items as { name: string; qty: number; set?: string; setQty?: number }[])
        .map(i => `${i.name} × ${i.qty} [${i.set} × ${i.setQty}]`));
    expect(jobs!.map(j => j.kind)).toEqual(['new', 'new']);
    expect(at(ids.kitchen)).toEqual(['Autotest set plov · qulyaj × 2 [Autotest set 1 × 2]']);
    expect(at(ids.bar)).toEqual(['Autotest set ayran × 4 [Autotest set 1 × 2]']);
  });

  it('takes nothing from stock before it is paid', async () => {
    expect(await stock(ids.rice)).toBe(10);
    expect(await stock(ids.yogurt)).toBe(10);
  });

  it('paid, takes each part\'s recipe once: 2 × 0.2 kq rice, 4 × 0.25 l yogurt', async () => {
    const pay = { orderId, status: 'ödənilib', cashAmount: 24, cardAmount: 0 };
    expect((await send(payOrder, pay)).body.ok).toBe(true);
    expect((await send(payOrder, pay)).body.ok).toBe(false);
    expect(await stock(ids.rice)).toBe(9.6);
    expect(await stock(ids.yogurt)).toBe(9);
    const { data: o } = await admin.from('orders').select('stock_applied, stock_error').eq('id', orderId).single();
    expect(o).toEqual({ stock_applied: true, stock_error: null });
  });

  it('is changed by its own owner only', async () => {
    const before = (await admin.from('menu_items').select('set_items').eq('id', ids.set).single()).data!.set_items;
    await ownerA.from('menu_items').update({ set_items: [] }).eq('id', ids.set);
    await anon.from('menu_items').update({ set_items: [] }).eq('id', ids.set);
    expect((await admin.from('menu_items').select('set_items').eq('id', ids.set).single()).data!.set_items).toEqual(before);
  });

  it('shows the public menu no list of its parts', async () => {
    const { data, error } = await anon.rpc('get_public_menu_items', { p_company_id: companyB.id });
    expect(error).toBeNull();
    const row = (data as Record<string, unknown>[]).find(r => r.id === ids.set);
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty('set_items');
  });
});

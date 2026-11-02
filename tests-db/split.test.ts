// "Hesabı böl", for real, on "restoran testing": an order sent to the kitchen
// is split through the real /api/split-order. Guest 2's bill is a new order on
// the same table, part of a line moves as its own row, the two bills add up to
// the old one, and the kitchen gets no new slip. A second send of the same split
// changes nothing; a paid order, a stranger's company and the public key are
// refused. Run in autotest-b, so no real till prints; its orders are removed.

import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as addOrder } from '@/app/api/add-order/route';
import { POST as splitOrder } from '@/app/api/split-order/route';
import { admin, anon, companyA, companyB, sellerA } from './setup';

const NOTE = 'Autotest split';
const orderId = randomUUID();
const guest2 = randomUUID();
const capId = randomUUID();
const croId = randomUUID();
const capPart = randomUUID();
let token = '';
let tableId = 0;

async function send(body: object, key = randomUUID()) {
  const res = await splitOrder(new NextRequest('http://localhost/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ companyId: companyB.id, token, ...body }),
  }));
  return { status: res.status, body: await res.json() };
}

async function ensure(table: string, name: string, extra: Record<string, unknown> = {}) {
  const { data } = await admin.from(table).select('id').eq('company_id', companyB.id).eq('name', name).maybeSingle();
  if (data) return data.id;
  const made = await admin.from(table).insert({ company_id: companyB.id, name, ...extra }).select('id').single();
  if (made.error) throw new Error(`${name}: ${made.error.message}`);
  return made.data.id;
}

const parts = [{ orderId: guest2, lines: [
  { id: capId, quantity: 2, newId: capPart },
  { id: croId, quantity: 1, newId: randomUUID() },
] }];

const lines = async (id: string) =>
  ((await admin.from('order_items').select('id, quantity, menu_item_price').eq('order_id', id).is('removed_at', null).order('menu_item_name')).data ?? []);
const sum = (rows: { quantity: number; menu_item_price: number }[]) => rows.reduce((s, r) => s + r.quantity * Number(r.menu_item_price), 0);
const jobs = async () =>
  ((await admin.from('print_jobs').select('id').in('order_id', [orderId, guest2])).data ?? []).length;

async function cleanUp() {
  // The note is on the original; the split-off bill is found by its table.
  const { data } = await admin.from('orders').select('id').eq('company_id', companyB.id).eq('note', NOTE);
  const ids = [...(data ?? []).map(o => o.id), guest2];
  await admin.from('print_jobs').delete().in('order_id', ids);
  await admin.from('order_items').delete().in('order_id', ids);
  await admin.from('orders').delete().in('id', ids);
}

beforeAll(async () => {
  await cleanUp();
  const { data: company } = await admin.from('companies').select('seller_token').eq('id', companyB.id).single();
  token = company!.seller_token;
  const stationId = await ensure('stations', 'Autotest mətbəx');
  const cap = await ensure('menu_items', 'Autotest split capucino', { price: 3, category: 'Autotest', position: 0, kind: 'meal', station_id: stationId });
  const cro = await ensure('menu_items', 'Autotest split kruassan', { price: 4, category: 'Autotest', position: 0, kind: 'meal', station_id: stationId });
  tableId = await ensure('restaurant_tables', 'Autotest split masa');

  const order = {
    id: orderId, orderNumber: 0, tableNumber: tableId, status: 'gözləyir', note: NOTE,
    createdAt: new Date().toISOString(), sellerName: 'autotest',
    items: [
      { id: capId, menuItem: { id: cap, name: 'Autotest split capucino', price: 3 }, quantity: 4 },
      { id: croId, menuItem: { id: cro, name: 'Autotest split kruassan', price: 4 }, quantity: 1 },
    ],
  };
  const r = await (await addOrder(new NextRequest('http://localhost/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ companyId: companyB.id, token, order }),
  }))).json();
  if (!r.ok) throw new Error(`add-order: ${JSON.stringify(r)}`);
});

afterAll(cleanUp);

describe('splitting a bill', () => {
  it('makes guest 2 a new bill on the same table, adding up to the old one', async () => {
    const slipsBefore = await jobs();
    expect(slipsBefore).toBeGreaterThan(0);          // the kitchen did get the order

    expect((await send({ orderId, parts })).body).toEqual({ ok: true });

    const a = await lines(orderId);
    const b = await lines(guest2);
    expect(a.map(r => r.quantity)).toEqual([2]);
    expect(b.map(r => r.id).sort()).toEqual([capPart, croId].sort());
    expect(sum(a) + sum(b)).toBe(16);

    const bill = (await admin.from('orders').select('table_id, status, order_number').eq('id', guest2).single()).data!;
    expect(bill.table_id).toBe(tableId);
    expect(bill.status).toBe('gözləyir');
    expect(bill.order_number).toBeGreaterThan(0);

    expect(await jobs()).toBe(slipsBefore);          // nothing new for the kitchen
  });

  it('changes nothing when the same split is sent again', async () => {
    expect((await send({ orderId, parts })).body).toEqual({ ok: true });
    expect((await lines(orderId)).map(r => r.quantity)).toEqual([2]);
    expect(await lines(guest2)).toHaveLength(2);
  });

  it('is refused from another company and from the public key', async () => {
    const other = await sellerA.rpc('split_order', { p_order_id: orderId, p_parts: parts });
    expect(other.error?.message).toMatch(/not_found/);
    expect(companyA.id).not.toBe(companyB.id);
    expect((await anon.rpc('split_order', { p_order_id: orderId, p_parts: parts })).error).not.toBeNull();
  });

  it('is refused on a paid order', async () => {
    await admin.from('orders').update({ status: 'ödənilib' }).eq('id', orderId);
    const r = await send({ orderId, parts: [{ orderId: randomUUID(), lines: [{ id: capId, quantity: 1, newId: randomUUID() }] }] });
    expect(r.status).toBe(409);
  });
});

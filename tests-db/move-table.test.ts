// Moving an order to another table, for real, on "restoran testing", through
// the route the till uses (/api/move-table): the order and its bill go with
// it, the table's name follows, it only moves to this restaurant's tables, a
// late replay of an old move does not drag the party back, and a paid order
// stays where it was paid. "Autotest masa 1" and "Autotest masa 2" are left in
// Kamran test ucun's Masalar, with the paid order in Sifarişlər.

import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { POST as addOrder } from '@/app/api/add-order/route';
import { POST as moveTable } from '@/app/api/move-table/route';
import { POST as payOrder } from '@/app/api/update-order-status/route';
import { admin, companyA, companyB, ownerA, sellerA, type TestCompany } from './setup';

const NOTE = 'Autotest masa';
const orderId = randomUUID();
let token = '';
const tables: Record<string, number> = {};

type Route = (req: NextRequest) => Promise<Response>;
async function send(route: Route, body: object, key: string = randomUUID()) {
  const res = await route(new NextRequest('http://localhost/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ companyId: companyA.id, token, ...body }),
  }));
  return { status: res.status, body: await res.json() };
}

async function where() {
  const { data } = await admin.from('orders').select('table_id, table_name').eq('id', orderId).single();
  const { data: items } = await admin.from('order_items').select('menu_item_price, quantity').eq('order_id', orderId).is('removed_at', null);
  const bill = (items ?? []).reduce((s, i) => s + Number(i.menu_item_price) * i.quantity, 0);
  return { table: data!.table_name, bill };
}

/** This restaurant's table by name, made by its owner the first time. */
async function table(company: TestCompany, name: string): Promise<number> {
  const { data } = await admin.from('restaurant_tables').select('id').eq('company_id', company.id).eq('name', name).maybeSingle();
  if (data) return data.id;
  const maker = company.id === companyA.id ? ownerA : admin;
  const made = await maker.from('restaurant_tables').insert({ company_id: company.id, name }).select('id').single();
  if (made.error) throw new Error(`table ${name}: ${made.error.message}`);
  return made.data.id;
}

beforeAll(async () => {
  const { data: company } = await admin.from('companies').select('seller_token').eq('id', companyA.id).single();
  token = company!.seller_token;

  const { data: old } = await admin.from('orders').select('id').eq('company_id', companyA.id).eq('note', NOTE);
  const oldIds = (old ?? []).map(o => o.id);
  if (oldIds.length) {
    await admin.from('order_items').delete().in('order_id', oldIds);
    await admin.from('orders').delete().in('id', oldIds);
  }

  tables.one = await table(companyA, 'Autotest masa 1');
  tables.two = await table(companyA, 'Autotest masa 2');
  tables.other = await table(companyB, 'Autotest masa B');
});

describe('moving an order to another table', () => {
  it('starts at Autotest masa 1 with 2 plov: 13.00', async () => {
    const order = {
      id: orderId, orderNumber: 0, tableNumber: tables.one, status: 'gözləyir', note: NOTE,
      createdAt: new Date().toISOString(), sellerName: 'autotest',
      items: [{ id: randomUUID(), menuItem: { id: randomUUID(), name: 'Autotest plov', price: 6.5 }, quantity: 2 }],
    };
    expect((await send(addOrder, { order })).body).toEqual({ ok: true });
    expect(await where()).toEqual({ table: 'Autotest masa 1', bill: 13 });
  });

  it('takes the order, its name and its bill to Autotest masa 2', async () => {
    expect((await send(moveTable, { orderId, tableId: tables.two })).body).toEqual({ ok: true });
    expect(await where()).toEqual({ table: 'Autotest masa 2', bill: 13 });
  });

  it("does not go to another restaurant's table", async () => {
    const res = await send(moveTable, { orderId, tableId: tables.other });
    expect(res.body).toEqual({ ok: false, error: 'table' });
    expect((await where()).table).toBe('Autotest masa 2');
  });

  it('is refused to a till without the right link', async () => {
    expect((await send(moveTable, { orderId, tableId: tables.one, token: 'wrong' })).status).toBe(403);
    expect((await where()).table).toBe('Autotest masa 2');
  });

  it('is not dragged back when an old move arrives late', async () => {
    const back = randomUUID();
    expect((await send(moveTable, { orderId, tableId: tables.one }, back)).body.ok).toBe(true);
    expect((await send(moveTable, { orderId, tableId: tables.two })).body.ok).toBe(true);
    // The till's queue sends the first move again, under its own key.
    expect((await send(moveTable, { orderId, tableId: tables.one }, back)).body.ok).toBe(true);
    expect((await where()).table).toBe('Autotest masa 2');
  });

  it('stays at the table it was paid at', async () => {
    expect((await send(payOrder, { orderId, status: 'ödənilib', cashAmount: 13, cardAmount: 0 })).body.ok).toBe(true);
    expect((await send(moveTable, { orderId, tableId: tables.one })).body.ok).toBe(false);
    expect(await where()).toEqual({ table: 'Autotest masa 2', bill: 13 });
  });

  it("keeps the paid order's table name when the table is renamed later", async () => {
    expect((await ownerA.from('restaurant_tables').update({ name: 'Autotest masa 2 (yeni)' }).eq('id', tables.two)).error).toBeNull();
    expect((await where()).table).toBe('Autotest masa 2');
    await ownerA.from('restaurant_tables').update({ name: 'Autotest masa 2' }).eq('id', tables.two);
  });

  it('are made and renamed by the owner only, not the seller', async () => {
    expect((await sellerA.from('restaurant_tables').insert({ company_id: companyA.id, name: 'Autotest satıcı masası' })).error).not.toBeNull();
    await sellerA.from('restaurant_tables').update({ name: 'hacked' }).eq('id', tables.one);
    const { data } = await admin.from('restaurant_tables').select('name').eq('id', tables.one).single();
    expect(data!.name).toBe('Autotest masa 1');
  });
});

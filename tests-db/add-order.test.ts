// A sale, for real, on "restoran testing", through the same server route the
// till uses (/api/add-order): only a till with the restaurant's link may make
// one, a replay is not a second sale, and no other restaurant or stranger sees
// it. The order is left in Kamran test ucun's Sifarişlər to look at; each run
// takes the last run's out first.

import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/add-order/route';
import type { Order } from '@/types';
import { admin, anon, companyA, ownerA, ownerB, sellerA } from './setup';

const NOTE = 'Autotest';
const orderId = randomUUID();
const lineId = randomUUID();
let token = '';
let order: Order;

function send(body: object, key = orderId) {
  return POST(new NextRequest('http://localhost/api/add-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(body),
  }));
}

async function linesNow() {
  const { data } = await admin.from('order_items').select('menu_item_name, quantity').eq('order_id', orderId);
  return data ?? [];
}

// Only the test's own orders: the restaurant may hold real ones.
beforeAll(async () => {
  const { data: old } = await admin.from('orders').select('id').eq('company_id', companyA.id).eq('note', NOTE);
  const oldIds = (old ?? []).map(o => o.id);
  if (oldIds.length) {
    await admin.from('order_items').delete().in('order_id', oldIds);
    await admin.from('orders').delete().in('id', oldIds);
  }

  const { data: company } = await admin.from('companies').select('seller_token').eq('id', companyA.id).single();
  token = company!.seller_token;

  const { data: dish } = await admin.from('menu_items').select('id, name, price')
    .eq('company_id', companyA.id).eq('name', 'Autotest plov').maybeSingle();
  const menuItem = dish ? { id: dish.id, name: dish.name, price: Number(dish.price) } : { id: randomUUID(), name: 'Autotest plov', price: 6.5 };

  order = {
    id: orderId, orderNumber: 0, tableNumber: 0, status: 'gözləyir', note: NOTE,
    createdAt: new Date().toISOString(), sellerName: 'autotest',
    items: [{ id: lineId, menuItem, quantity: 2 }],
  } as unknown as Order;
});

describe('a sale', () => {
  it('is refused to a till without the right link', async () => {
    const res = await send({ order, companyId: companyA.id, token: 'wrong' }, randomUUID());
    expect(res.status).toBe(403);
    expect((await admin.from('orders').select('id').eq('id', orderId)).data).toEqual([]);
  });

  it('is refused to a stranger going straight to the database', async () => {
    const { error } = await anon.from('orders').insert({ id: orderId, company_id: companyA.id, status: 'gözləyir', waiter_name: 'x' });
    expect(error).not.toBeNull();
    expect((await admin.from('orders').select('id').eq('id', orderId)).data).toEqual([]);
  });

  it('is made by the till with its link, with a number and its dishes', async () => {
    const res = await send({ order, companyId: companyA.id, token });
    expect(await res.json()).toEqual({ ok: true });
    const { data } = await admin.from('orders').select('order_number, status').eq('id', orderId).single();
    expect(data!.status).toBe('gözləyir');
    expect(data!.order_number).toBeGreaterThan(0);
    expect(await linesNow()).toEqual([{ menu_item_name: 'Autotest plov', quantity: 2 }]);
  });

  it('is one sale when the till sends it twice', async () => {
    expect((await (await send({ order, companyId: companyA.id, token })).json()).ok).toBe(true);
    expect((await (await send({ order, companyId: companyA.id, token }, randomUUID())).json()).ok).toBe(true);
    expect((await admin.from('orders').select('id').eq('id', orderId)).data).toHaveLength(1);
    expect(await linesNow()).toHaveLength(1);
  });

  it('is seen by its own owner and seller, not by another restaurant or a stranger', async () => {
    expect((await ownerA.from('orders').select('id').eq('id', orderId)).data).toHaveLength(1);
    expect((await sellerA.from('orders').select('id').eq('id', orderId)).data).toHaveLength(1);
    expect((await ownerB.from('orders').select('id').eq('id', orderId)).data).toEqual([]);
    expect((await anon.from('orders').select('id').eq('id', orderId)).data ?? []).toEqual([]);
    expect((await ownerB.from('order_items').select('id').eq('order_id', orderId)).data).toEqual([]);
    expect((await anon.from('order_items').select('id').eq('order_id', orderId)).data ?? []).toEqual([]);
  });
});

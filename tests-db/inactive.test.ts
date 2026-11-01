// A restaurant switched off or put in the trash, or an account switched off,
// for real, on "restoran testing": a login already open, and the till's link,
// stop working at once, in the database and in the server routes, and work
// again when switched back on. Run on autotest-b (switched off and on here),
// never on a restaurant someone uses; it is always put back on at the end.

import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as addOrder } from '@/app/api/add-order/route';
import { GET as sellerToken } from '@/app/api/seller-token/route';
import { GET as users } from '@/app/api/users/route';
import { admin, companyB, ownerB } from './setup';

const NOTE = 'Autotest bağlı';
let token = '';
let slug = '';
let ownerId = '';
let dishId = '';

const bearer = async () => `Bearer ${(await ownerB.auth.getSession()).data.session!.access_token}`;

/** What the owner, the till and the routes can do right now. */
async function reach() {
  const auth = { headers: { Authorization: await bearer() } };
  const menu = await ownerB.from('menu_items').select('id').eq('id', dishId);
  const write = await ownerB.from('menu_items').update({ price: 1 }).eq('id', dishId).select('id');
  const order = await addOrder(new NextRequest('http://localhost/api/add-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({
      companyId: companyB.id, token,
      order: {
        id: randomUUID(), orderNumber: 0, tableNumber: 0, status: 'gözləyir', note: NOTE, createdAt: new Date().toISOString(),
        sellerName: 'autotest', items: [{ id: randomUUID(), menuItem: { id: dishId, name: 'Autotest bağlı', price: 1 }, quantity: 1 }],
      },
    }),
  }));
  const link = await sellerToken(new NextRequest(`http://localhost/api/seller-token?slug=${slug}&token=${token}`));
  const own = await sellerToken(new NextRequest('http://localhost/api/seller-token', auth));
  const list = await users(new NextRequest('http://localhost/api/users', auth));
  return {
    reads: (menu.data ?? []).length > 0,
    writes: (write.data ?? []).length > 0,
    till: order.status,
    link: link.status,
    ownLink: own.status,
    users: list.status,
  };
}

const open = { reads: true, writes: true, till: 200, link: 200, ownLink: 200, users: 200 };

async function putBack() {
  await admin.from('companies').update({ active: true, trashed_at: null }).eq('id', companyB.id);
  if (ownerId) await admin.from('profiles').update({ active: true }).eq('id', ownerId);
}

beforeAll(async () => {
  await putBack();
  const { data: company } = await admin.from('companies').select('seller_token, slug').eq('id', companyB.id).single();
  token = company!.seller_token;
  slug = company!.slug;
  ownerId = (await ownerB.auth.getUser()).data.user!.id;
  const { data } = await admin.from('menu_items').select('id').eq('company_id', companyB.id).eq('name', 'Autotest bağlı').maybeSingle();
  dishId = data?.id ?? (await ownerB.from('menu_items').insert({
    company_id: companyB.id, name: 'Autotest bağlı', price: 1, category: 'Autotest', position: 0, kind: 'meal',
  }).select('id').single()).data!.id;
});

afterAll(async () => {
  await putBack();
  const { data } = await admin.from('orders').select('id').eq('company_id', companyB.id).eq('note', NOTE);
  const ids = (data ?? []).map(o => o.id);
  if (ids.length) {
    await admin.from('print_jobs').delete().in('order_id', ids);
    await admin.from('order_items').delete().in('order_id', ids);
    await admin.from('orders').delete().in('id', ids);
  }
});

describe('switched off', () => {
  it('a working restaurant: the owner, the till and the routes all work', async () => {
    expect(await reach()).toEqual(open);
  });

  it('a restaurant switched off: the open login and the till link stop at once', async () => {
    await admin.from('companies').update({ active: false }).eq('id', companyB.id);
    expect(await reach()).toEqual({ reads: false, writes: false, till: 403, link: 404, ownLink: 403, users: 403 });
    await putBack();
    expect(await reach()).toEqual(open);
  });

  it('a restaurant in the trash: the same', async () => {
    await admin.from('companies').update({ trashed_at: new Date().toISOString() }).eq('id', companyB.id);
    expect(await reach()).toEqual({ reads: false, writes: false, till: 403, link: 404, ownLink: 403, users: 403 });
    await putBack();
    expect(await reach()).toEqual(open);
  });

  it('an account switched off: its open login stops, the till link goes on', async () => {
    await admin.from('profiles').update({ active: false }).eq('id', ownerId);
    const r = await reach();
    expect(r).toMatchObject({ reads: false, writes: false, till: 200, link: 200 });
    expect(r.ownLink).not.toBe(200);
    expect(r.users).not.toBe(200);
    await putBack();
    expect(await reach()).toEqual(open);
  });
});

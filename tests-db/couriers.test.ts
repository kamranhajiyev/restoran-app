// Courier money, for real, on "restoran testing", through the routes the till
// uses: deliveries closed on a rider make his debt, what he hands over lowers
// it once and lands in the drawer, he cannot hand over more than he owes, and
// food he brings back stops owing. His balance is read the way the till reads
// it (/api/public-couriers, courierBalances). "Autotest kuryer" and his orders
// are left in Kamran test ucun's Kuryerlər to look at; each run takes the last
// run's orders and payments out first.

import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { POST as addOrder } from '@/app/api/add-order/route';
import { POST as payOrder } from '@/app/api/update-order-status/route';
import { POST as addCourierPayment } from '@/app/api/add-courier-payment/route';
import { POST as returnOrder } from '@/app/api/return-courier-order/route';
import { POST as openShift } from '@/app/api/open-shift/route';
import { POST as closeShift } from '@/app/api/close-shift/route';
import { GET as publicCouriers } from '@/app/api/public-couriers/route';
import { TILL_TOKEN_HEADER } from '@/lib/till-read-token';
import type { ShiftMovement } from '@/types';
import { admin, companyA, companyB, ownerA, sellerA } from './setup';

const NAME = 'Autotest kuryer';
const NOTE = 'Autotest kuryer';
const BY = 'autotest';
let token = '';
let courierId = '';
let otherCourierId = '';
let shiftId = '';
const first = randomUUID();   // 10 ₼
const second = randomUUID();  // 15 ₼
const takeaway = randomUUID();
const paymentId = randomUUID();

type Route = (req: NextRequest) => Promise<Response>;
async function send(route: Route, body: object, key: string = randomUUID()) {
  const res = await route(new NextRequest('http://localhost/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ companyId: companyA.id, token, ...body }),
  }));
  return { status: res.status, body: await res.json() };
}

/** The rider as the till sees him: what he owes and on which orders. */
async function rider() {
  const res = await publicCouriers(new NextRequest(`http://localhost/api/public-couriers?companyId=${companyA.id}`, {
    headers: { [TILL_TOKEN_HEADER]: token },
  }));
  const { couriers } = await res.json() as { couriers: { id: string; outstanding: number; pending: { id: string; owed: number }[] }[] };
  const me = couriers.find(c => c.id === courierId)!;
  return { owes: me.outstanding, pending: me.pending.map(p => `${p.id === first ? 'first' : p.id === second ? 'second' : p.id} ${p.owed}`) };
}

async function delivery(id: string, price: number, courier: string | undefined) {
  const order = {
    id, orderNumber: 0, tableNumber: 0, status: 'gözləyir', note: NOTE, createdAt: new Date().toISOString(),
    sellerName: BY, ...(courier ? { courierId: courier } : {}),
    items: [{ id: randomUUID(), menuItem: { id: randomUUID(), name: 'Autotest dönər', price }, quantity: 1 }],
  };
  expect((await send(addOrder, { order })).body).toEqual({ ok: true });
  // Closed on the rider: the guest pays him, so the restaurant is owed it.
  const pay = courier
    ? { orderId: id, status: 'ödənilib', cashAmount: 0, cardAmount: 0, courierDebt: price }
    : { orderId: id, status: 'ödənilib', cashAmount: price, cardAmount: 0 };
  expect((await send(payOrder, pay)).body.ok).toBe(true);
}

// Only the test's own rows: the restaurant may hold real ones.
beforeAll(async () => {
  const { data: company } = await admin.from('companies').select('seller_token').eq('id', companyA.id).single();
  token = company!.seller_token;

  const { data: open } = await admin.from('cash_shifts').select('opened_by').eq('company_id', companyA.id).is('closed_at', null);
  if (open?.some(s => s.opened_by !== BY)) throw new Error('Kamran test ucun has a shift open that is not the test\'s: close it first, it is left alone');
  await admin.from('cash_shifts').delete().eq('company_id', companyA.id).eq('opened_by', BY).is('closed_at', null);

  const { data: existing } = await admin.from('couriers').select('id').eq('company_id', companyA.id).eq('name', NAME).maybeSingle();
  if (existing) {
    courierId = existing.id;
    await admin.from('courier_payments').delete().eq('courier_id', courierId);
  } else {
    // Made by the owner, as the Kuryerlər page does.
    const { data, error } = await ownerA.from('couriers').insert({ company_id: companyA.id, name: NAME }).select('id').single();
    if (error) throw new Error(`courier: ${error.message}`);
    courierId = data.id;
  }
  const { data: old } = await admin.from('orders').select('id').eq('company_id', companyA.id).eq('note', NOTE);
  const oldIds = (old ?? []).map(o => o.id);
  if (oldIds.length) {
    await admin.from('order_items').delete().in('order_id', oldIds);
    await admin.from('orders').delete().in('id', oldIds);
  }

  const { data: other } = await admin.from('couriers').select('id').eq('company_id', companyB.id).eq('name', NAME).maybeSingle();
  otherCourierId = other?.id
    ?? (await admin.from('couriers').insert({ company_id: companyB.id, name: NAME }).select('id').single()).data!.id;
});

describe('a courier', () => {
  it('is added by the owner only', async () => {
    const { error } = await sellerA.from('couriers').insert({ company_id: companyA.id, name: 'Autotest satıcının kuryeri' });
    expect(error).not.toBeNull();
  });

  it('owes 10 + 15 = 25 for two deliveries closed on him; a counter sale is not his', async () => {
    shiftId = (await send(openShift, { openingCash: 0, openedBy: BY })).body.shift.id;
    await delivery(first, 10, courierId);
    await delivery(second, 15, courierId);
    await delivery(takeaway, 8, undefined);
    expect(await rider()).toEqual({ owes: 25, pending: ['first 10', 'second 15'] });
  });

  it('pays 10 once, even when sent twice, and it goes in the drawer', async () => {
    const pay = { paymentId, courierId, amount: 10, by: BY, shiftId, method: 'nağd', orderIds: [first] };
    expect((await send(addCourierPayment, pay)).body.ok).toBe(true);
    expect((await send(addCourierPayment, pay)).body.ok).toBe(true);
    expect(await rider()).toEqual({ owes: 15, pending: ['second 15'] });
    const { data } = await admin.from('cash_shifts').select('movements').eq('id', shiftId).single();
    expect((data!.movements as ShiftMovement[]).map(m => `${m.reason} ${m.amount}`)).toEqual(['Kuryer ödənişi 10']);
  });

  it('cannot hand over more than he owes', async () => {
    const res = await send(addCourierPayment, { paymentId: randomUUID(), courierId, amount: 20, by: BY, shiftId, method: 'nağd' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/overpay/);
    expect((await rider()).owes).toBe(15);
  });

  it("is refused to a till without the right link, and for another restaurant's rider", async () => {
    expect((await send(addCourierPayment, { paymentId: randomUUID(), courierId, amount: 1, token: 'wrong' })).status).toBe(403);
    expect((await send(addCourierPayment, { paymentId: randomUUID(), courierId: otherCourierId, amount: 1 })).status).toBe(404);
    expect((await send(returnOrder, { orderId: second, reason: 'x', by: 'x', token: 'wrong' })).status).toBe(403);
    expect((await rider()).owes).toBe(15);
  });

  it('owes nothing for food he brought back, once, even when sent twice', async () => {
    const back = { orderId: second, reason: 'Qonaq imtina etdi', by: BY };
    expect((await send(returnOrder, back)).body.ok).toBe(true);
    expect((await send(returnOrder, back)).body.ok).toBe(true);
    const { data } = await admin.from('orders').select('status').eq('id', second).single();
    expect(data!.status).toBe('ləğv edildi');
    expect(await rider()).toEqual({ owes: 0, pending: [] });
  });

  it('cannot "bring back" a counter sale', async () => {
    expect((await send(returnOrder, { orderId: takeaway, reason: 'x', by: BY })).body.ok).toBe(false);
    const { data } = await admin.from('orders').select('status').eq('id', takeaway).single();
    expect(data!.status).toBe('ödənilib');
  });

  it('leaves the shift holding 8 sold at the counter + 10 from the rider = 18', async () => {
    const close = { shiftId, expectedCash: 18, countedCash: 18, cardSales: 0, countedCard: 0, closedBy: BY };
    expect((await send(closeShift, close)).body.ok).toBe(true);
    const { data } = await admin.from('cash_shifts').select('movements, closed_at').eq('id', shiftId).single();
    expect(data!.closed_at).not.toBeNull();
    const { data: paid } = await admin.from('orders').select('cash_amount').eq('id', takeaway).single();
    const moved = (data!.movements as ShiftMovement[]).reduce((s, m) => s + m.amount, 0);
    expect(Number(paid!.cash_amount) + moved).toBe(18);
  });
});

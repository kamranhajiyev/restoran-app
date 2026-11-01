// The money on one sale and one shift, for real, on "restoran testing", through
// the routes the till uses: a quantity lowered, a dish taken off, the bill paid,
// cash put in and taken out, the shift closed. Each step is sent twice, the way
// a till on a bad line does, and must count once. Totals come from the same
// lib functions every screen uses. The paid order and the closed shift are left
// in Kamran test ucun (Sifarişlər, Kassa) to look at; each run takes the last
// run's out first.

import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { POST as addOrder } from '@/app/api/add-order/route';
import { POST as updateQty } from '@/app/api/update-order-item-qty/route';
import { POST as removeItems } from '@/app/api/remove-order-items/route';
import { POST as payOrder } from '@/app/api/update-order-status/route';
import { POST as openShift } from '@/app/api/open-shift/route';
import { POST as addMovement } from '@/app/api/add-shift-movement/route';
import { POST as closeShift } from '@/app/api/close-shift/route';
import { orderTotal } from '@/components/seller/order-format';
import { splitOrderItems, type OrderItemRow } from '@/lib/order-items';
import { expectedCash } from '@/lib/shift-cash';
import { shiftSales } from '@/lib/shift-sales';
import type { Order, ShiftMovement } from '@/types';
import { admin, companyA } from './setup';

const NOTE = 'Autotest pul';
const BY = 'autotest';
const orderId = randomUUID();
const plovLine = randomUUID();
const teaLine = randomUUID();
let token = '';
let shiftId = '';

type Route = (req: NextRequest) => Promise<Response>;
async function send(route: Route, body: object, key: string = randomUUID()) {
  const res = await route(new NextRequest('http://localhost/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ companyId: companyA.id, token, ...body }),
  }));
  return { status: res.status, body: await res.json() };
}

/** The bill as every screen works it out: the order's rows through splitOrderItems and orderTotal. */
async function billNow(): Promise<{ total: number; lines: number; removed: number }> {
  const { data, error } = await admin.from('order_items')
    .select('id, menu_item_id, menu_item_name, menu_item_price, quantity, removed_at').eq('order_id', orderId);
  if (error) throw error;
  const { items, removedItems } = splitOrderItems(data as OrderItemRow[]);
  return { total: orderTotal({ items } as Order), lines: items.length, removed: removedItems.length };
}

async function shiftNow() {
  const { data, error } = await admin.from('cash_shifts').select('*').eq('id', shiftId).single();
  if (error) throw error;
  return data;
}

// Only the test's own orders and shifts: the restaurant may hold real ones.
beforeAll(async () => {
  const { data: old } = await admin.from('orders').select('id').eq('company_id', companyA.id).eq('note', NOTE);
  const oldIds = (old ?? []).map(o => o.id);
  if (oldIds.length) {
    await admin.from('order_items').delete().in('order_id', oldIds);
    await admin.from('orders').delete().in('id', oldIds);
  }
  const { data: open } = await admin.from('cash_shifts').select('opened_by').eq('company_id', companyA.id).is('closed_at', null);
  if (open?.some(s => s.opened_by !== BY)) throw new Error('Kamran test ucun has a shift open that is not the test\'s: close it first, it is left alone');
  await admin.from('cash_shifts').delete().eq('company_id', companyA.id).eq('opened_by', BY);

  const { data: company } = await admin.from('companies').select('seller_token').eq('id', companyA.id).single();
  token = company!.seller_token;
});

describe('a shift and a sale', () => {
  it('opens a shift with 50 ₼ in the drawer', async () => {
    const res = await send(openShift, { openingCash: 50, openedBy: BY });
    expect(res.status).toBe(200);
    shiftId = res.body.shift.id;
    expect(Number(res.body.shift.opening_cash)).toBe(50);
  });

  it('takes an order of 3 plov at 6.50 and 2 tea at 1.00: 21.50', async () => {
    const order = {
      id: orderId, orderNumber: 0, tableNumber: 0, status: 'gözləyir', note: NOTE,
      createdAt: new Date().toISOString(), sellerName: BY,
      items: [
        { id: plovLine, menuItem: { id: randomUUID(), name: 'Autotest plov', price: 6.5 }, quantity: 3 },
        { id: teaLine, menuItem: { id: randomUUID(), name: 'Autotest çay', price: 1 }, quantity: 2 },
      ],
    };
    expect((await send(addOrder, { order })).body).toEqual({ ok: true });
    expect(await billNow()).toEqual({ total: 21.5, lines: 2, removed: 0 });
  });

  it('lowers the plov to 2 once, even when sent twice: 15.00', async () => {
    const key = randomUUID();
    const body = { orderId, orderItemId: plovLine, quantity: 2, removedBy: BY };
    expect((await send(updateQty, body, key)).body.ok).toBe(true);
    expect((await send(updateQty, body, key)).body.ok).toBe(true);
    // One struck-through plov for the kitchen's cancel slip, not two.
    expect(await billNow()).toEqual({ total: 15, lines: 2, removed: 1 });
  });

  it('takes the tea off once, even when sent twice: 13.00', async () => {
    const body = { orderId, lines: [{ orderItemId: teaLine, quantity: 0 }], removedBy: BY };
    const key = randomUUID();
    expect((await send(removeItems, body, key)).body.ok).toBe(true);
    expect((await send(removeItems, body, randomUUID())).body.ok).toBe(true);
    expect(await billNow()).toEqual({ total: 13, lines: 1, removed: 2 });
  });

  it('refuses every change from a till without the right link', async () => {
    const wrong = { token: 'wrong' };
    expect((await send(updateQty, { orderId, orderItemId: plovLine, quantity: 1, ...wrong })).status).toBe(403);
    expect((await send(removeItems, { orderId, lines: [{ orderItemId: plovLine, quantity: 0 }], ...wrong })).status).toBe(403);
    expect((await send(payOrder, { orderId, status: 'ödənilib', cashAmount: 0, ...wrong })).status).toBe(403);
    expect((await send(addMovement, { shiftId, movement: { at: new Date().toISOString(), amount: -50, reason: 'x', by: 'x' }, ...wrong })).status).toBe(403);
    expect(await billNow()).toEqual({ total: 13, lines: 1, removed: 2 });
  });

  it('is paid 13.00 in cash once; a second payment is refused', async () => {
    const pay = { orderId, status: 'ödənilib', cashAmount: 13, cardAmount: 0, changeAmount: 0 };
    expect((await send(payOrder, pay)).body.ok).toBe(true);
    expect((await send(payOrder, { ...pay, cashAmount: 0, cardAmount: 13 })).body.ok).toBe(false);
    const { data } = await admin.from('orders').select('status, cash_amount, card_amount').eq('id', orderId).single();
    expect(data).toEqual({ status: 'ödənilib', cash_amount: 13, card_amount: 0 });
  });

  it('is not changed once paid', async () => {
    expect((await send(updateQty, { orderId, orderItemId: plovLine, quantity: 1 })).status).toBe(409);
    expect((await send(removeItems, { orderId, lines: [{ orderItemId: plovLine, quantity: 0 }] })).status).toBe(409);
    expect(await billNow()).toEqual({ total: 13, lines: 1, removed: 2 });
  });

  it('books 20 ₼ in and 5 ₼ out once each, even when sent twice', async () => {
    const moveIn: ShiftMovement = { at: new Date().toISOString(), amount: 20, reason: 'Autotest mədaxil', by: BY };
    const moveOut: ShiftMovement = { at: new Date().toISOString(), amount: -5, reason: 'Autotest məxaric', by: BY };
    const keyIn = randomUUID();
    expect((await send(addMovement, { shiftId, movement: moveIn }, keyIn)).body.ok).toBe(true);
    expect((await send(addMovement, { shiftId, movement: moveIn }, keyIn)).body.ok).toBe(true);
    expect((await send(addMovement, { shiftId, movement: moveOut })).body.ok).toBe(true);
    const amounts = ((await shiftNow()).movements as ShiftMovement[]).map(m => m.amount);
    expect(amounts).toEqual([20, -5]);
  });

  it('should hold 50 + 13 + 20 − 5 = 78 ₼ and closes once at that', async () => {
    const shift = await shiftNow();
    const { data: paid } = await admin.from('orders')
      .select('cash_amount, card_amount, courier_debt, courier_cash, courier_card')
      .eq('company_id', companyA.id).eq('status', 'ödənilib').gte('paid_at', shift.opened_at);
    const sales = shiftSales(paid ?? [], []);
    expect(sales).toMatchObject({ cash: 13, card: 0 });
    const should = expectedCash({ openingCash: Number(shift.opening_cash), movements: shift.movements }, sales.cash);
    expect(should).toBe(78);

    const close = { shiftId, expectedCash: should, countedCash: 78, cardSales: 0, countedCard: 0, closedBy: BY };
    expect((await send(closeShift, close)).body.ok).toBe(true);
    // A second close from another till must not write over the first count.
    expect((await send(closeShift, { ...close, countedCash: 1 })).body.ok).toBe(true);
    const closed = await shiftNow();
    expect(closed.closed_at).not.toBeNull();
    expect([Number(closed.expected_cash), Number(closed.counted_cash)]).toEqual([78, 78]);
  });
});

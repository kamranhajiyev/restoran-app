// Order numbers, for real, on "restoran testing", through the route the till
// uses (/api/add-order): orders sent at the same moment never share a number,
// a number a till already printed is kept and the counter moves past it, two
// offline tills that both printed one number both arrive (№45 and №45/2), two
// plain №45s never stand (the route renumbers the second,
// 20261106_order_number_per_till.sql), and one restaurant's numbers never move
// another's.
//
// These orders are taken out again at the end: a dozen open orders would clog
// the till of whoever is testing on Kamran test ucun.

import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as addOrder } from '@/app/api/add-order/route';
import { admin, companyA, companyB, type TestCompany } from './setup';

const NOTE = 'Autotest nömrə';
const tokens = new Map<string, string>();

function order(extra: Record<string, unknown> = {}) {
  return {
    id: randomUUID(), orderNumber: 0, tableNumber: 0, status: 'gözləyir', note: NOTE,
    createdAt: new Date().toISOString(), sellerName: 'autotest',
    items: [{ id: randomUUID(), menuItem: { id: randomUUID(), name: 'Autotest çay', price: 1 }, quantity: 1 }],
    ...extra,
  };
}

async function send(o: ReturnType<typeof order>, company: TestCompany = companyA, keepOrderNumber = false) {
  const res = await addOrder(new NextRequest('http://localhost/api/add-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': o.id },
    body: JSON.stringify({ order: o, companyId: company.id, token: tokens.get(company.id), keepOrderNumber }),
  }));
  return res.json();
}

async function numberOf(id: string): Promise<{ order_number: number; till_number: number | null }> {
  const { data, error } = await admin.from('orders').select('order_number, till_number').eq('id', id).single();
  if (error) throw error;
  return data;
}

async function clear() {
  const { data } = await admin.from('orders').select('id').in('company_id', [companyA.id, companyB.id]).eq('note', NOTE);
  const ids = (data ?? []).map(o => o.id);
  if (!ids.length) return;
  await admin.from('order_items').delete().in('order_id', ids);
  await admin.from('orders').delete().in('id', ids);
}

beforeAll(async () => {
  await clear();
  const { data } = await admin.from('companies').select('id, seller_token').in('id', [companyA.id, companyB.id]);
  for (const c of data ?? []) tokens.set(c.id, c.seller_token);
});
afterAll(clear);

describe('order numbers', () => {
  it('are all different when ten orders arrive at the same moment', async () => {
    const orders = Array.from({ length: 10 }, () => order());
    const answers = await Promise.all(orders.map(o => send(o)));
    expect(answers.every(a => a.ok)).toBe(true);
    const numbers = (await Promise.all(orders.map(o => numberOf(o.id)))).map(n => n.order_number).sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(10);
    // Handed out one after another, with no gap between them.
    expect(numbers.at(-1)! - numbers[0]).toBe(9);
  });

  it("keep a number the till already printed, and the next order goes past it", async () => {
    const first = order();
    await send(first);
    const printed = (await numberOf(first.id)).order_number + 5;
    const offline = order({ orderNumber: printed, tillNumber: 2 });
    expect(await send(offline, companyA, true)).toEqual({ ok: true });
    expect(await numberOf(offline.id)).toEqual({ order_number: printed, till_number: 2 });

    const next = order();
    await send(next);
    expect((await numberOf(next.id)).order_number).toBe(printed + 1);
  });

  it('let two offline tills that printed the same number both arrive, told apart', async () => {
    const base = order();
    await send(base);
    const n = (await numberOf(base.id)).order_number + 1;
    const till1 = order({ orderNumber: n, tillNumber: 1 });
    const till2 = order({ orderNumber: n, tillNumber: 2 });
    expect(await send(till1, companyA, true)).toEqual({ ok: true });
    expect(await send(till2, companyA, true)).toEqual({ ok: true });
    // Both keep the number they printed: №n and №n/2.
    expect(await numberOf(till1.id)).toEqual({ order_number: n, till_number: 1 });
    expect(await numberOf(till2.id)).toEqual({ order_number: n, till_number: 2 });
  });

  it('never keep two plain №n: the second is renumbered by the server, not lost', async () => {
    const base = order();
    await send(base);
    const n = (await numberOf(base.id)).order_number + 1;
    // Till 1 and the web till both show a plain №n.
    const fromTill = order({ orderNumber: n, tillNumber: 1 });
    const again = order({ orderNumber: n });
    expect(await send(fromTill, companyA, true)).toEqual({ ok: true });
    expect(await send(again, companyA, true)).toEqual({ ok: true });
    expect((await numberOf(fromTill.id)).order_number).toBe(n);
    const second = await numberOf(again.id);
    expect(second.order_number).not.toBe(n);
    const { count } = await admin.from('order_items').select('id', { count: 'exact', head: true }).eq('order_id', again.id);
    expect(count).toBe(1);
  });

  it("of one restaurant never move another's", async () => {
    const before = order();
    await send(before, companyB);
    const bFirst = (await numberOf(before.id)).order_number;
    await Promise.all(Array.from({ length: 3 }, () => send(order())));
    const after = order();
    await send(after, companyB);
    expect((await numberOf(after.id)).order_number).toBe(bFirst + 1);
  });
});

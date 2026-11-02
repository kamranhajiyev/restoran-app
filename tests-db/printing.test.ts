// Kitchen tickets, for real, on "restoran testing", through the routes a till
// uses (/api/claim-print-jobs, /api/report-print-job): an order makes one
// ticket for its station, more dishes make an "append" ticket, an unticked
// dish makes none, a dish taken off makes a cancel slip, two tills asking at
// once never both get one ticket, a printed ticket is never handed out again,
// a failed one comes back until it is given up on, and one restaurant's till
// never sees another's.
//
// Run in autotest-b, which nobody uses: a real till open on Kamran test ucun
// would collect the tickets and print them. Each run takes the last run's
// orders and tickets out first.

import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { POST as addOrder } from '@/app/api/add-order/route';
import { POST as addItems } from '@/app/api/add-order-items/route';
import { POST as updateQty } from '@/app/api/update-order-item-qty/route';
import { POST as claimJobs } from '@/app/api/claim-print-jobs/route';
import { POST as reportJob } from '@/app/api/report-print-job/route';
import { admin, companyA, companyB, ownerB, sellerA } from './setup';

const NOTE = 'Autotest çap';
const orderId = randomUUID();
const kebabLine = randomUUID();
let tokenA = '';
let tokenB = '';
let stationId = '';
let kebabId = '';

type Route = (req: NextRequest) => Promise<Response>;
async function send(route: Route, body: object, token = tokenB, companyId = companyB.id) {
  const res = await route(new NextRequest('http://localhost/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ companyId, token, ...body }),
  }));
  return { status: res.status, body: await res.json() };
}

type Job = { id: string; kind: string; payload: { items?: { name: string; qty: number }[] } };
const claim = async (token = tokenB, companyId = companyB.id): Promise<Job[]> => {
  const res = await send(claimJobs, { limit: 10 }, token, companyId);
  return res.body.jobs ?? [];
};

async function jobsOfOrder() {
  const { data } = await admin.from('print_jobs').select('id, kind, status, attempts').eq('order_id', orderId).order('created_at');
  return data ?? [];
}

const line = (id: string, name: string, menuId: string, quantity: number, extra = {}) =>
  ({ id, menuItem: { id: menuId, name, price: 5 }, quantity, ...extra });

beforeAll(async () => {
  const { data: tokens } = await admin.from('companies').select('id, seller_token').in('id', [companyA.id, companyB.id]);
  tokenA = tokens!.find(c => c.id === companyA.id)!.seller_token;
  tokenB = tokens!.find(c => c.id === companyB.id)!.seller_token;

  const { data: st } = await admin.from('stations').select('id').eq('company_id', companyB.id).eq('name', 'Autotest mətbəx').maybeSingle();
  stationId = st?.id ?? (await ownerB.from('stations').insert({ company_id: companyB.id, name: 'Autotest mətbəx' }).select('id').single()).data!.id;
  const { data: dish } = await admin.from('menu_items').select('id').eq('company_id', companyB.id).eq('name', 'Autotest kabab').maybeSingle();
  kebabId = dish?.id ?? (await ownerB.from('menu_items').insert({
    company_id: companyB.id, name: 'Autotest kabab', price: 5, category: 'Autotest', position: 0, kind: 'product', station_id: stationId,
  }).select('id').single()).data!.id;
  if (!stationId || !kebabId) throw new Error('autotest-b station or dish missing');

  const { data: old } = await admin.from('orders').select('id').eq('company_id', companyB.id).eq('note', NOTE);
  const oldIds = (old ?? []).map(o => o.id);
  if (oldIds.length) {
    await admin.from('print_jobs').delete().in('order_id', oldIds);
    await admin.from('order_items').delete().in('order_id', oldIds);
    await admin.from('orders').delete().in('id', oldIds);
  }
  // Nothing else of autotest-b's may be waiting, or the claims below would take it.
  await admin.from('print_jobs').delete().eq('company_id', companyB.id);
});

describe('kitchen tickets', () => {
  it("make one ticket for the station; a dish unticked for the kitchen makes none", async () => {
    const order = {
      id: orderId, orderNumber: 0, tableNumber: 0, status: 'gözləyir', note: NOTE,
      createdAt: new Date().toISOString(), sellerName: 'autotest',
      items: [
        line(kebabLine, 'Autotest kabab', kebabId, 2),
        line(randomUUID(), 'Autotest kabab', kebabId, 1, { noPrint: true }),
      ],
    };
    expect((await send(addOrder, { order })).body).toEqual({ ok: true });
    const jobs = await jobsOfOrder();
    expect(jobs.map(j => `${j.kind} ${j.status}`)).toEqual(['new pending']);
  });

  it("are never handed to another restaurant's till", async () => {
    expect((await send(claimJobs, { limit: 10 }, tokenA, companyB.id)).status).toBe(403);
    const theirs = await claim(tokenA, companyA.id);
    const ours = (await jobsOfOrder()).map(j => j.id);
    expect(theirs.filter(j => ours.includes(j.id))).toEqual([]);
    expect((await jobsOfOrder())[0].status).toBe('pending');
  });

  it('go to one till only when two ask at the same moment', async () => {
    const [a, b] = await Promise.all([claim(), claim()]);
    const ids = [...a, ...b].map(j => j.id);
    expect(ids).toHaveLength(1);
    const [job] = [...a, ...b];
    expect(job.kind).toBe('new');
    // A plain dish: no set (20261109_set_block_tickets.sql gives every line the keys).
    expect(job.payload.items).toEqual([expect.objectContaining({ name: 'Autotest kabab', qty: 2, modifiers: null, set: null, setQty: null })]);
  });

  it('are not handed out again once printed', async () => {
    const [job] = await jobsOfOrder();
    expect((await send(reportJob, { id: job.id, outcome: { result: 'printed' } })).body.ok).toBe(true);
    expect(await claim()).toEqual([]);
    expect((await jobsOfOrder())[0].status).toBe('printed');
  });

  it('cannot be reported by another restaurant\'s till', async () => {
    const [job] = await jobsOfOrder();
    expect((await send(reportJob, { id: job.id, outcome: { result: 'release' } }, tokenA, companyB.id)).status).toBe(403);
    await send(reportJob, { id: job.id, outcome: { result: 'release' } }, tokenA, companyA.id);
    expect((await jobsOfOrder())[0].status).toBe('printed');
  });

  it("make an append ticket for dishes added later", async () => {
    expect((await send(addItems, { orderId, items: [line(randomUUID(), 'Autotest kabab', kebabId, 1)] })).body.ok).toBe(true);
    const jobs = await claim();
    expect(jobs.map(j => `${j.kind} ${j.payload.items?.map(i => i.qty).join()}`)).toEqual(['append 1']);
    await send(reportJob, { id: jobs[0].id, outcome: { result: 'printed' } });
  });

  it('make a cancel slip when a dish is taken off', async () => {
    expect((await send(updateQty, { orderId, orderItemId: kebabLine, quantity: 1 })).body.ok).toBe(true);
    const jobs = await claim();
    expect(jobs.map(j => j.kind)).toEqual(['cancel']);
    await send(reportJob, { id: jobs[0].id, outcome: { result: 'printed' } });
  });

  it('come back after a failed print, and stop once given up on', async () => {
    expect((await send(addItems, { orderId, items: [line(randomUUID(), 'Autotest kabab', kebabId, 3)] })).body.ok).toBe(true);
    const [job] = await claim();
    await send(reportJob, { id: job.id, outcome: { result: 'failed', attempts: 1, error: 'printer off', giveUp: false } });
    const again = await claim();
    expect(again.map(j => j.id)).toEqual([job.id]);
    await send(reportJob, { id: job.id, outcome: { result: 'failed', attempts: 5, error: 'printer off', giveUp: true } });
    expect(await claim()).toEqual([]);
    const { data } = await admin.from('print_jobs').select('status, attempts, error').eq('id', job.id).single();
    expect(data).toEqual({ status: 'failed', attempts: 5, error: 'printer off' });
  });

  it('are made and changed by the owner only, not by the seller or a till', async () => {
    expect((await sellerA.from('stations').insert({ company_id: companyA.id, name: 'Autotest satıcı' })).error).not.toBeNull();
    const { data } = await sellerA.from('print_jobs').select('id').eq('order_id', orderId);
    expect(data ?? []).toEqual([]);
  });
});

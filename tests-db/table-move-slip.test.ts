// The "MASA DƏYİŞDİ" slip, for real, on "restoran testing": moving an order
// through the real /api/move-table queues a "move" slip at the station that
// holds its ticket, naming the table it came from; with the owner's switch
// off the order still moves but no slip is queued; only the owner flips the
// switch. Run in autotest-b, so no real till prints the slips; the switch is
// put back on and the orders and slips are removed at the end.

import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as addOrder } from '@/app/api/add-order/route';
import { POST as moveTable } from '@/app/api/move-table/route';
import { admin, anon, companyA, companyB, ownerB, sellerA } from './setup';

const NOTE = 'Autotest slip';
const orderId = randomUUID();
let token = '';
let stationId = '';
let dishId = '';
const tables = { one: 0, two: 0 };

async function send(route: (req: NextRequest) => Promise<Response>, body: object) {
  const res = await route(new NextRequest('http://localhost/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ companyId: companyB.id, token, ...body }),
  }));
  return { status: res.status, body: await res.json() };
}

async function ensure(table: string, name: string, extra: Record<string, unknown> = {}) {
  const { data } = await admin.from(table).select('id').eq('company_id', companyB.id).eq('name', name).maybeSingle();
  if (data) return data.id;
  const made = await ownerB.from(table).insert({ company_id: companyB.id, name, ...extra }).select('id').single();
  if (made.error) throw new Error(`${name}: ${made.error.message}`);
  return made.data.id;
}

const slips = async () =>
  ((await admin.from('print_jobs').select('station_id, payload').eq('order_id', orderId).eq('kind', 'move').order('created_at')).data ?? []);
const tableOf = async () => (await admin.from('orders').select('table_id').eq('id', orderId).single()).data!.table_id;
const switchOn = async () => (await admin.from('companies').select('print_table_move').eq('id', companyB.id).single()).data!.print_table_move;

async function cleanUp() {
  const { data } = await admin.from('orders').select('id').eq('company_id', companyB.id).eq('note', NOTE);
  const ids = (data ?? []).map(o => o.id);
  if (!ids.length) return;
  await admin.from('print_jobs').delete().in('order_id', ids);
  await admin.from('order_items').delete().in('order_id', ids);
  await admin.from('orders').delete().in('id', ids);
}

beforeAll(async () => {
  await cleanUp();
  await admin.from('companies').update({ print_table_move: true }).eq('id', companyB.id);
  const { data: company } = await admin.from('companies').select('seller_token').eq('id', companyB.id).single();
  token = company!.seller_token;
  stationId = await ensure('stations', 'Autotest mətbəx');
  dishId = await ensure('menu_items', 'Autotest slip kabab', { price: 5, category: 'Autotest', position: 0, kind: 'meal', station_id: stationId });
  tables.one = await ensure('restaurant_tables', 'Autotest slip masa 1');
  tables.two = await ensure('restaurant_tables', 'Autotest slip masa 2');

  const order = {
    id: orderId, orderNumber: 0, tableNumber: tables.one, status: 'gözləyir', note: NOTE,
    createdAt: new Date().toISOString(), sellerName: 'autotest',
    items: [{ id: randomUUID(), menuItem: { id: dishId, name: 'Autotest slip kabab', price: 5 }, quantity: 1 }],
  };
  const r = await send(addOrder, { order });
  if (!r.body.ok) throw new Error(`add-order: ${JSON.stringify(r.body)}`);
});

afterAll(async () => {
  await admin.from('companies').update({ print_table_move: true }).eq('id', companyB.id);
  await cleanUp();
});

describe('the table-move slip', () => {
  it('is queued at the station holding the ticket, naming the table it came from', async () => {
    expect((await send(moveTable, { orderId, tableId: tables.two })).body).toEqual({ ok: true });
    const s = await slips();
    expect(s).toHaveLength(1);
    expect(s[0].station_id).toBe(stationId);
    expect(s[0].payload.fromTable).toBe(tables.one);
  });

  it('is not queued once the owner turns it off; the order still moves', async () => {
    expect((await ownerB.rpc('set_print_table_move', { enabled: false })).error).toBeNull();
    expect(await switchOn()).toBe(false);
    expect((await send(moveTable, { orderId, tableId: tables.one })).body).toEqual({ ok: true });
    expect(await tableOf()).toBe(tables.one);
    expect(await slips()).toHaveLength(1);
  });

  it('comes back when the owner turns it on again', async () => {
    expect((await ownerB.rpc('set_print_table_move', { enabled: true })).error).toBeNull();
    expect((await send(moveTable, { orderId, tableId: tables.two })).body).toEqual({ ok: true });
    expect(await slips()).toHaveLength(2);
  });

  it('is switched by the owner only', async () => {
    const before = (await admin.from('companies').select('print_table_move').eq('id', companyA.id).single()).data!.print_table_move;
    expect((await sellerA.rpc('set_print_table_move', { enabled: !before })).error?.message).toMatch(/not_owner/);
    expect((await anon.rpc('set_print_table_move', { enabled: false })).error).not.toBeNull();
    expect((await admin.from('companies').select('print_table_move').eq('id', companyA.id).single()).data!.print_table_move).toBe(before);
    expect(await switchOn()).toBe(true);
  });
});

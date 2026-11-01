// The QR menu's orders, for real, on "restoran testing", through the real
// /api/guest-order: the guest picks dishes and the server sets everything else
// (price from the menu, status gözləyir, no money), a second send makes no
// second order, a dish that is off, hidden from the QR menu or another
// restaurant's is refused, another restaurant's table is refused, and a closed
// or menu-only restaurant takes nothing. Kamran test ucun keeps the last run's
// order (note "Autotest QR", 2 çay + 1 big pizza = 19.00, gözləyir) and the
// dishes in Menyu → Autotest QR.

import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET, POST } from '@/app/api/guest-order/route';
import { orderTotal } from '@/components/seller/order-format';
import { splitOrderItems } from '@/lib/order-items';
import { admin, anon, companyA, companyB, ownerA, ownerB, type TestCompany } from './setup';

const CATEGORY = 'Autotest QR';
const NOTE = 'Autotest QR';
const dishes = { tea: '', pizza: '', hidden: '', off: '', other: '' };
let tableA = 0;
let tableB = 0;

async function order(body: object) {
  const res = await POST(new NextRequest('http://localhost/api/guest-order', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
}

async function typeFor(company: TestCompany, table?: number) {
  const q = new URLSearchParams({ companyId: company.id, ...(table ? { table: String(table) } : {}) });
  const res = await GET(new NextRequest(`http://localhost/api/guest-order?${q}`));
  return { status: res.status, body: await res.json() };
}

const saved = async (id: string) =>
  (await admin.from('orders').select('*, order_items(*)').eq('id', id).maybeSingle()).data;

/** One dish by name, put back as the test wants it each run. */
async function dish(company: TestCompany, maker: typeof ownerA, name: string, fields: Record<string, unknown>): Promise<string> {
  const row = { price: 1, available: true, qr_visible: true, variants: null, ...fields };
  const { data } = await admin.from('menu_items').select('id').eq('company_id', company.id).eq('name', name).maybeSingle();
  if (data) {
    const upd = await maker.from('menu_items').update(row).eq('id', data.id);
    if (upd.error) throw new Error(`${name}: ${upd.error.message}`);
    return data.id;
  }
  const made = await maker.from('menu_items').insert({ company_id: company.id, name, category: CATEGORY, position: 0, ...row }).select('id').single();
  if (made.error) throw new Error(`${name}: ${made.error.message}`);
  return made.data.id;
}

async function table(company: TestCompany, maker: typeof ownerA, name: string): Promise<number> {
  const { data } = await admin.from('restaurant_tables').select('id').eq('company_id', company.id).eq('name', name).maybeSingle();
  if (data) return data.id;
  const made = await maker.from('restaurant_tables').insert({ company_id: company.id, name }).select('id').single();
  if (made.error) throw new Error(`${name}: ${made.error.message}`);
  return made.data.id;
}

async function dropOrders(company: TestCompany) {
  const { data } = await admin.from('orders').select('id').eq('company_id', company.id).eq('note', NOTE);
  const ids = (data ?? []).map(o => o.id);
  if (!ids.length) return;
  await admin.from('order_items').delete().in('order_id', ids);
  await admin.from('orders').delete().in('id', ids);
}

const countOrders = async (company: TestCompany) =>
  (await admin.from('orders').select('id', { count: 'exact', head: true }).eq('company_id', company.id).eq('note', NOTE)).count;

beforeAll(async () => {
  await dropOrders(companyA);
  await dropOrders(companyB);
  const { data: cat } = await admin.from('categories').select('id').eq('company_id', companyA.id).eq('name', CATEGORY).maybeSingle();
  if (!cat) await ownerA.from('categories').insert({ company_id: companyA.id, name: CATEGORY });
  dishes.tea = await dish(companyA, ownerA, 'Autotest QR çay', { price: 2 });
  dishes.pizza = await dish(companyA, ownerA, 'Autotest QR pizza', { price: 10, variants: [{ id: 'big', name: 'Böyük', price: 15 }] });
  dishes.hidden = await dish(companyA, ownerA, 'Autotest QR gizli', { price: 3, qr_visible: false });
  dishes.off = await dish(companyA, ownerA, 'Autotest QR bitib', { price: 3, available: false });
  dishes.other = await dish(companyB, ownerB, 'Autotest QR B yeməyi', { price: 1 });
  tableA = await table(companyA, ownerA, 'Autotest QR masa');
  tableB = await table(companyB, ownerB, 'Autotest QR masa B');
});

// autotest-b is switched off and on below; put it back whatever happens.
afterAll(async () => {
  await admin.from('companies').update({ active: true, menu_only: false, qr_enabled: true }).eq('id', companyB.id);
  await dropOrders(companyB);
});

describe('a QR order', () => {
  const id = randomUUID();

  it('is priced from the menu and waits for the till, whatever the guest sends', async () => {
    const r = await order({
      id, companyId: companyA.id, tableId: tableA, note: NOTE,
      status: 'hazırdır', cash: 100, card: 100, paid: true, service_charge_percent: 50,
      lines: [
        { menuItemId: dishes.tea, quantity: 2, price: 0.01 },
        { menuItemId: dishes.pizza, variantId: 'big', quantity: 1, price: 0.01 },
      ],
    });
    expect(r).toEqual({ status: 200, body: { ok: true } });

    const o = await saved(id);
    expect(o).toMatchObject({ company_id: companyA.id, table_id: tableA, status: 'gözləyir', waiter_name: 'Müştəri', online: false });
    expect(Number(o.cash ?? 0) + Number(o.card ?? 0)).toBe(0);
    expect(o.service_charge_percent ?? null).toBeNull();
    const { items } = splitOrderItems(o.order_items);
    expect(items.map(i => [i.menuItem.name, i.menuItem.price, i.quantity]).sort()).toEqual([
      ['Autotest QR pizza', 15, 1],
      ['Autotest QR çay', 2, 2],
    ]);
    // What the till will ask the guest to pay.
    expect(orderTotal({ items } as never)).toBe(19);
  });

  it('at a table is Masa, as the menu told the guest', async () => {
    const t = await typeFor(companyA, tableA);
    expect(t).toMatchObject({ status: 200, body: { ok: true, type: { builtIn: 'masa' } } });
    // A plain Masa with no price change writes no type, like a till order.
    expect((await saved(id)).order_type ?? null).toBeNull();
  });

  it('sent twice is one order with its dishes once', async () => {
    const again = await order({ id, companyId: companyA.id, tableId: tableA, note: NOTE, lines: [{ menuItemId: dishes.tea, quantity: 5 }] });
    expect(again).toEqual({ status: 200, body: { ok: true } });
    expect(await countOrders(companyA)).toBe(1);
    expect((await saved(id)).order_items).toHaveLength(2);
  });

  it('without a table goes out as a takeaway', async () => {
    const takeaway = randomUUID();
    expect((await order({ id: takeaway, companyId: companyA.id, note: NOTE, lines: [{ menuItemId: dishes.tea, quantity: 1 }] })).status).toBe(200);
    expect(await saved(takeaway)).toMatchObject({ table_id: null, online: true, status: 'gözləyir' });
    await admin.from('order_items').delete().eq('order_id', takeaway);
    await admin.from('orders').delete().eq('id', takeaway);
  });
});

describe('a QR order is refused', () => {
  const tries: [string, object, number, string][] = [
    ['for a dish that is off', { lines: [{ menuItemId: 'off', quantity: 1 }] }, 400, 'unavailable'],
    ['for a dish hidden from the QR menu', { lines: [{ menuItemId: 'hidden', quantity: 1 }] }, 400, 'unavailable'],
    ['for another restaurant\'s dish', { lines: [{ menuItemId: 'other', quantity: 1 }] }, 400, 'unavailable'],
    ['for a pizza without its size', { lines: [{ menuItemId: 'pizza', quantity: 1 }] }, 400, 'pick_variant'],
    ['for half a çay', { lines: [{ menuItemId: 'tea', quantity: 0.5 }] }, 400, 'bad_quantity'],
    ['with nothing in it', { lines: [] }, 400, 'bad_lines'],
    ['at another restaurant\'s table', { tableId: 'B', lines: [{ menuItemId: 'tea', quantity: 1 }] }, 400, 'bad_table'],
  ];

  for (const [what, body, status, error] of tries) {
    it(what, async () => {
      const lines = (body as { lines: { menuItemId: keyof typeof dishes }[] }).lines.map(l => ({ ...l, menuItemId: dishes[l.menuItemId] }));
      const tableId = (body as { tableId?: string }).tableId ? tableB : undefined;
      const id = randomUUID();
      const r = await order({ id, companyId: companyA.id, note: NOTE, ...body, tableId, lines });
      expect(r.status).toBe(status);
      expect(r.body.error).toBe(error);
      expect(await saved(id)).toBeNull();
    });
  }

  it('without an id, or for no restaurant', async () => {
    expect((await order({ companyId: companyA.id, lines: [{ menuItemId: dishes.tea, quantity: 1 }] })).status).toBe(400);
    expect((await order({ id: randomUUID(), companyId: 'kamran', lines: [] })).status).toBe(400);
    expect((await order({ id: randomUUID(), companyId: randomUUID(), lines: [{ menuItemId: dishes.tea, quantity: 1 }] })).status).toBe(403);
  });

  it('when the restaurant is menu-only, has QR off, or is switched off', async () => {
    const send = async () => {
      const id = randomUUID();
      const r = await order({ id, companyId: companyB.id, note: NOTE, lines: [{ menuItemId: dishes.other, quantity: 1 }] });
      return { ...r, saved: await saved(id) };
    };
    expect((await send()).status).toBe(200);   // open: it takes the order

    for (const closed of [{ menu_only: true }, { qr_enabled: false }, { active: false }]) {
      await admin.from('companies').update(closed).eq('id', companyB.id);
      const r = await send();
      expect(r.status).toBe(403);
      expect(r.body.error).toBe('closed');
      expect(r.saved).toBeNull();
      await admin.from('companies').update({ active: true, menu_only: false, qr_enabled: true }).eq('id', companyB.id);
    }
  });

  it('straight into the database with the public key', async () => {
    const id = randomUUID();
    const r = await anon.from('orders').insert({ id, company_id: companyA.id, status: 'gözləyir', note: NOTE, created_at: new Date().toISOString() });
    expect(r.error).not.toBeNull();
    expect(await saved(id)).toBeNull();
  });
});

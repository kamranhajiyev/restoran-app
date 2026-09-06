// Reading and writing the till's database.
//
// Every function here answers in exactly the shape app/seller/page.tsx already
// consumes from the /api/public-* routes — same field names, same ordering,
// same defaults. That is deliberate: the page is 3300 lines built against those
// shapes, and a local backend that returned "almost" the same objects would
// surface as wrong prices and missing lines rather than as a type error.
//
// Compare each read below with its route in app/api/ when changing one.

import type {
  CashShift, Category, Courier, Hall, MenuItem, ModifierGroup, Order,
  RestaurantTable, Staff, Station,
} from '../types';
import { db, docs, transact } from './db';

export interface StationReady {
  orderId: string;
  stationId: string;
  readyAt: string;
  readyBy: string | null;
}

// ── Reference data ───────────────────────────────────────────────────────────
// The menu and the room. The server is their only author, so a sync replaces
// them wholesale rather than merging: an item the owner deleted has to actually
// disappear from the till, and a diff that fails to notice a deletion leaves a
// dish on the screen that can still be ordered.

export function getMenu(companyId: string): MenuItem[] {
  return docs<MenuItem>(
    db().prepare('select doc from menu_items where company_id = ? order by position').all(companyId),
  );
}

export function getCategories(companyId: string): Category[] {
  return docs<Category>(
    db().prepare('select doc from categories where company_id = ? order by position').all(companyId),
  );
}

export function getTables(companyId: string): { tables: RestaurantTable[]; halls: Hall[] } {
  return {
    tables: docs<RestaurantTable>(
      db().prepare('select doc from tables where company_id = ? order by id').all(companyId),
    ),
    halls: docs<Hall>(
      db().prepare('select doc from halls where company_id = ? order by position, id').all(companyId),
    ),
  };
}

export function getStaff(companyId: string): Staff[] {
  return docs<Staff>(
    db().prepare('select doc from staff where company_id = ? order by created_at').all(companyId),
  );
}

/**
 * Couriers, with a balance the till can trust while the line is down.
 *
 * `outstanding` arrives from the server as a snapshot — it has to, because a
 * courier's debt can be older than the window of orders this machine keeps, so
 * there is nothing local to recompute it from. What the till *can* do is add
 * what has happened here since that snapshot was taken: deliveries closed on
 * debt, and cash taken off a courier at this counter. Both are filtered by the
 * snapshot's own timestamp, so once a sync folds them into the server's number
 * they stop being counted twice.
 */
export function getCouriers(companyId: string): Courier[] {
  const rows = docs<Courier & { outstanding?: number; syncedAt?: string }>(
    db().prepare('select doc from couriers where company_id = ? order by created_at').all(companyId),
  );

  return rows.map(c => {
    const since = c.syncedAt ?? '';
    const delivered = db().prepare(
      `select coalesce(sum(json_extract(doc, '$.courierDebt')), 0) as v from orders
        where company_id = ? and json_extract(doc, '$.courierId') = ?
          and json_extract(doc, '$.status') = 'ödənilib'
          and coalesce(json_extract(doc, '$.paidAt'), '') > ?`,
    ).get(companyId, c.id, since) as { v: number };
    const paid = db().prepare(
      'select coalesce(sum(amount), 0) as v from courier_payments where company_id = ? and courier_id = ? and created_at > ?',
    ).get(companyId, c.id, since) as { v: number };

    return { ...c, outstanding: (c.outstanding ?? 0) + (delivered.v ?? 0) - (paid.v ?? 0) };
  });
}

/** One settlement taken at this counter. Ignores an id already present, so a
 *  replayed request cannot decrement the same balance twice. */
export function addCourierPayment(
  companyId: string,
  row: {
    id: string; courierId: string; amount: number; createdAt: string;
    createdBy?: string; shiftId?: string | null; method?: 'nağd' | 'kart';
  },
): void {
  db().prepare(
    `insert or ignore into courier_payments (id, company_id, courier_id, amount, created_at, doc)
     values (?, ?, ?, ?, ?, ?)`,
  ).run(row.id, companyId, row.courierId, row.amount, row.createdAt, JSON.stringify(row));
}

export function hasCourierPayment(id: string): boolean {
  return !!db().prepare('select 1 from courier_payments where id = ?').get(id);
}

/** Settlements this machine took in [from, to), split by how the money arrived.
 *  The method lives in `doc` rather than a column: the schema is created once
 *  with `create table if not exists` and never altered, so a new column would
 *  exist on fresh installs and be missing on every till already in a kitchen.
 *  Rows written before the method existed were cash — nothing else was on
 *  offer — which is what the coalesce says. */
export function getCourierCollections(
  companyId: string,
  from: string,
  to: string,
): { nagd: number; kart: number } {
  const row = db().prepare(
    `select
       coalesce(sum(case when json_extract(doc, '$.method') = 'kart' then amount end), 0) as kart,
       coalesce(sum(case when coalesce(json_extract(doc, '$.method'), 'nağd') <> 'kart' then amount end), 0) as nagd
     from courier_payments
      where company_id = ? and created_at >= ? and created_at < ?`,
  ).get(companyId, from, to) as { nagd: number; kart: number };

  return { nagd: Number(row?.nagd ?? 0), kart: Number(row?.kart ?? 0) };
}

export function getModifierGroups(companyId: string): ModifierGroup[] {
  return docs<ModifierGroup>(
    db().prepare('select doc from modifier_groups where company_id = ? order by position').all(companyId),
  );
}

export function getStations(companyId: string): Station[] {
  return docs<Station>(
    db().prepare('select doc from stations where company_id = ? order by position').all(companyId),
  );
}

/** One reference table, replaced. Callers pass rows already in domain shape. */
type RefTable = 'menu_items' | 'categories' | 'tables' | 'halls' | 'staff' | 'couriers' | 'modifier_groups' | 'stations';

export function replaceReference(
  table: RefTable,
  companyId: string,
  rows: Record<string, unknown>[],
): void {
  const handle = db();
  transact(() => {
    handle.prepare(`delete from ${table} where company_id = ?`).run(companyId);

    for (const [i, row] of rows.entries()) {
      const doc = JSON.stringify(row);
      switch (table) {
        case 'categories':
          handle
            .prepare('insert into categories (company_id, name, position, doc) values (?, ?, ?, ?)')
            .run(companyId, String(row.name), Number(row.position ?? i), doc);
          break;
        case 'tables':
          handle
            .prepare('insert into tables (id, company_id, doc) values (?, ?, ?)')
            .run(Number(row.id), companyId, doc);
          break;
        case 'staff':
        case 'couriers':
          handle
            .prepare(`insert into ${table} (id, company_id, created_at, doc) values (?, ?, ?, ?)`)
            .run(String(row.id), companyId, String(row.createdAt ?? ''), doc);
          break;
        default:
          handle
            .prepare(`insert into ${table} (id, company_id, position, doc) values (?, ?, ?, ?)`)
            .run(String(row.id), companyId, Number(row.position ?? i), doc);
      }
    }
  });
}

// ── Orders ───────────────────────────────────────────────────────────────────

export function getOrders(
  companyId: string,
  opts: { from?: string; to?: string; limit?: number; offset?: number } = {},
): { orders: Order[]; total: number } {
  const limit = opts.limit ?? 200;
  const offset = opts.offset ?? 0;

  const where = ['company_id = ?'];
  const args: unknown[] = [companyId];
  if (opts.from) { where.push('created_at >= ?'); args.push(opts.from); }
  if (opts.to) { where.push('created_at <= ?'); args.push(opts.to); }
  const clause = where.join(' and ');

  const total = Number(
    db().prepare(`select count(*) as n from orders where ${clause}`).get(...args)?.n ?? 0,
  );

  const rows = db()
    .prepare(`select doc from orders where ${clause} order by created_at desc limit ? offset ?`)
    .all(...args, limit, offset);

  return { orders: docs<Order>(rows), total };
}

export function getOrder(id: string): Order | null {
  const row = db().prepare('select doc from orders where id = ?').get(id);
  return row ? (JSON.parse(String(row.doc)) as Order) : null;
}

/** Insert or overwrite one order, keeping the indexed columns in step. */
export function putOrder(companyId: string, order: Order): void {
  db()
    .prepare(
      `insert into orders (id, company_id, order_number, status, created_at, paid_at, cash_amount, card_amount, doc)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(id) do update set
         order_number = excluded.order_number,
         status       = excluded.status,
         created_at   = excluded.created_at,
         paid_at      = excluded.paid_at,
         cash_amount  = excluded.cash_amount,
         card_amount  = excluded.card_amount,
         doc          = excluded.doc`,
    )
    .run(
      order.id,
      companyId,
      order.orderNumber ?? 0,
      order.status,
      order.createdAt ?? '',
      order.paidAt ?? null,
      Number(order.cashAmount ?? 0),
      Number(order.cardAmount ?? 0),
      JSON.stringify(order),
    );
}

// ── Which sexes have finished ────────────────────────────────────────────────

export function getStationReady(companyId: string): StationReady[] {
  // Bounded the same way /api/public-station-ready is: an open order is recent,
  // and an unbounded read grows forever on a busy venue.
  const rows = db()
    .prepare(
      `select order_id, station_id, ready_at, ready_by from station_ready
       where company_id = ? order by ready_at desc limit 500`,
    )
    .all(companyId);

  return rows.map(r => ({
    orderId: String(r.order_id),
    stationId: String(r.station_id),
    readyAt: String(r.ready_at),
    readyBy: r.ready_by === null || r.ready_by === undefined ? null : String(r.ready_by),
  }));
}

export function putStationReady(companyId: string, rows: StationReady[]): void {
  const handle = db();
  transact(() => {
    for (const r of rows) {
      handle
        .prepare(
          `insert into station_ready (order_id, station_id, company_id, ready_at, ready_by)
           values (?, ?, ?, ?, ?)
           on conflict(order_id, station_id) do update set
             ready_at = excluded.ready_at, ready_by = excluded.ready_by`,
        )
        .run(r.orderId, r.stationId, companyId, r.readyAt, r.readyBy);
    }
  });
}

export function clearStationReady(orderId: string, stationId: string): void {
  db().prepare('delete from station_ready where order_id = ? and station_id = ?').run(orderId, stationId);
}

// ── The cash shift ───────────────────────────────────────────────────────────

export function getOpenShift(companyId: string): CashShift | null {
  const row = db()
    .prepare(
      `select doc from shifts where company_id = ? and closed_at is null
       order by opened_at desc limit 1`,
    )
    .get(companyId);
  return row ? (JSON.parse(String(row.doc)) as CashShift) : null;
}

export function putShift(companyId: string, shift: CashShift): void {
  db()
    .prepare(
      `insert into shifts (id, company_id, opened_at, closed_at, doc)
       values (?, ?, ?, ?, ?)
       on conflict(id) do update set
         opened_at = excluded.opened_at,
         closed_at = excluded.closed_at,
         doc       = excluded.doc`,
    )
    .run(shift.id, companyId, shift.openedAt, shift.closedAt ?? null, JSON.stringify(shift));
}

/** Cash and card taken since the shift opened. Mirrors /api/public-shift-sales. */
export function getShiftSales(companyId: string, openedAt: string): { cash: number; card: number } {
  const row = db()
    .prepare(
      `select coalesce(sum(cash_amount), 0) as cash, coalesce(sum(card_amount), 0) as card
       from orders
       where company_id = ? and status = 'ödənilib' and paid_at >= ?`,
    )
    .get(companyId, openedAt);

  return { cash: Number(row?.cash ?? 0), card: Number(row?.card ?? 0) };
}

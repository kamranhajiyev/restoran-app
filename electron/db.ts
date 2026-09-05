// The till's own database, on the restaurant's PC.
//
// This is what makes the desktop app work with the cable unplugged. The till
// reads and writes here and nowhere else; electron/sync.ts carries the result to
// Supabase later, on its own time. Nothing the waiter does waits for a network.
//
// ── Why the rows are JSON ────────────────────────────────────────────────────
// Each table keeps the domain object exactly as types/index.ts defines it, in a
// `doc` column, with only the columns the till actually filters or sorts on
// pulled out beside it. The alternative — a faithful relational mirror of the
// Postgres schema — means two mappings per entity (row→object here, row→object
// on the server) that must agree forever, and the day they drift the till shows
// a wrong price. Here the object that arrives from Supabase is the object the
// till reads back, byte for byte.
//
// The cost is that SQL cannot query inside an order's items. Nothing needs to:
// the till loads orders whole and filters them in the page, exactly as it does
// today against /api/public-orders.

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

let _db: DatabaseSync | null = null;

/** Bumped when the statements below need a shape the old file cannot answer. */
const SCHEMA_VERSION = 1;

const SCHEMA = `
-- Reference data: the menu and the room. Replaced wholesale on every sync,
-- because the server is the only author — nothing on the till edits these.
create table if not exists menu_items (
  id          text primary key,
  company_id  text not null,
  position    integer not null default 0,
  doc         text not null
);

create table if not exists categories (
  company_id  text not null,
  name        text not null,
  position    integer not null default 0,
  doc         text not null,
  primary key (company_id, name)
);

create table if not exists tables (
  id          integer primary key,
  company_id  text not null,
  doc         text not null
);

create table if not exists halls (
  id          text primary key,
  company_id  text not null,
  position    integer not null default 0,
  doc         text not null
);

create table if not exists staff (
  id          text primary key,
  company_id  text not null,
  created_at  text not null default '',
  doc         text not null
);

create table if not exists couriers (
  id          text primary key,
  company_id  text not null,
  created_at  text not null default '',
  doc         text not null
);

-- Courier settlements taken on this machine. Separate from the outbox, which
-- forgets a write once it has been sent: this is what lets the Kuryerlər screen
-- show a correct balance during an outage, by adding what this till has done to
-- the balance the server last told it.
create table if not exists courier_payments (
  id          text primary key,
  company_id  text not null,
  courier_id  text not null,
  amount      real not null,
  created_at  text not null default '',
  doc         text not null
);

create table if not exists modifier_groups (
  id          text primary key,
  company_id  text not null,
  position    integer not null default 0,
  doc         text not null
);

create table if not exists stations (
  id          text primary key,
  company_id  text not null,
  position    integer not null default 0,
  doc         text not null
);

-- The state of the room. Written by the till AND by the server (another
-- terminal's orders arrive on sync), so rows carry enough to be merged.
-- paid_at and the two amounts are lifted out of the doc because the shift
-- report sums them over a date range, which is the one query the till makes
-- that would otherwise have to parse every order in the file.
create table if not exists orders (
  id           text primary key,
  company_id   text not null,
  order_number integer not null default 0,
  status       text not null default '',
  created_at   text not null default '',
  paid_at      text,
  cash_amount  real not null default 0,
  card_amount  real not null default 0,
  doc          text not null
);
create index if not exists orders_by_created on orders (company_id, created_at desc);
create index if not exists orders_by_paid on orders (company_id, status, paid_at);

create table if not exists station_ready (
  order_id    text not null,
  station_id  text not null,
  company_id  text not null,
  ready_at    text not null default '',
  ready_by    text,
  primary key (order_id, station_id)
);

create table if not exists shifts (
  id          text primary key,
  company_id  text not null,
  opened_at   text not null default '',
  closed_at   text,
  doc         text not null
);

-- What the till has done that Supabase has not seen yet.
--
-- Same discipline as lib/offline-queue.ts, which this replaces on the desktop:
-- the id doubles as the idempotency key so a reply lost on the way back cannot
-- charge a guest twice, and seq keeps strict FIFO across restarts because "add
-- items to order X" must never overtake the insert that created order X.
create table if not exists outbox (
  id          text primary key,
  seq         integer not null,
  kind        text not null,
  body        text not null,
  company_id  text,
  queued_at   text not null,
  attempts    integer not null default 0
);
create index if not exists outbox_by_seq on outbox (seq);

-- Small key/value corner: schema version, last sync time, which company this
-- machine belongs to.
create table if not exists meta (
  key   text primary key,
  value text not null
);
`;

export function openDb(userDataDir: string): DatabaseSync {
  if (_db) return _db;

  const db = new DatabaseSync(path.join(userDataDir, 'till.db'));

  // A restaurant loses power; that is usually *why* the line went down. WAL
  // plus a real fsync at each commit is the difference between losing the last
  // order and losing the file.
  db.exec('pragma journal_mode = wal');
  db.exec('pragma synchronous = full');
  db.exec('pragma foreign_keys = on');
  db.exec(SCHEMA);

  const found = Number(getMeta(db, 'schema_version') ?? 0);
  if (found !== SCHEMA_VERSION) setMeta(db, 'schema_version', String(SCHEMA_VERSION));

  _db = db;
  return db;
}

export function db(): DatabaseSync {
  if (!_db) throw new Error('till database not open');
  return _db;
}

export function getMeta(handle: DatabaseSync, key: string): string | null {
  const row = handle.prepare('select value from meta where key = ?').get(key);
  return row ? String(row.value) : null;
}

export function setMeta(handle: DatabaseSync, key: string, value: string): void {
  handle
    .prepare('insert into meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value')
    .run(key, value);
}

/** Run several statements as one unit, so a crash cannot leave half a write. */
export function transact<T>(fn: () => T): T {
  const handle = db();
  handle.exec('begin immediate');
  try {
    const result = fn();
    handle.exec('commit');
    return result;
  } catch (e) {
    handle.exec('rollback');
    throw e;
  }
}

/** The stored object, parsed. Rows are only ever written by this process. */
export function docs<T>(rows: Record<string, unknown>[]): T[] {
  return rows.map(r => JSON.parse(String(r.doc)) as T);
}

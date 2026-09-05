// What the till does, applied to the machine it is standing on.
//
// Phase 2 gave the till its own copy of the restaurant to read from. This is the
// other half: every write the waiter makes lands *here* first — in SQLite, in a
// transaction, with an outbox row recording that Supabase has not seen it yet —
// and the network is not involved at all. The screen updates because the
// database did, not because a request came back.
//
// That inversion is the whole point of the offline till. The old code asked "am
// I online?" before every write and took a different path for each answer, which
// meant the offline path was the one nobody tested and the one that lost an
// order. Here there is one path. electron/sync.ts drains the outbox behind it,
// on its own time, and if it never gets the chance the orders are still on the
// disk in the morning.
//
// ── Why the outbox body is a route ───────────────────────────────────────────
// Each entry's `kind` is the API route that will replay it (or a `supabase:`
// marker for the two writes that have no route). So an entry is literally the
// request that was not sent, and the replay in lib/sync.ts already knows how to
// send it. Nothing here invents a second wire format.
//
// ── Why applying locally is hand-written ─────────────────────────────────────
// Every function below mirrors what its route in app/api/ does to the row, and
// has to keep mirroring it. The alternative — waiting for the server's answer to
// know what happened — is the thing this file exists to avoid. When a route
// changes, change its twin here; the comment on each one says which.

import type { CashShift, Order, OrderItem, ShiftMovement } from '../types';
import { db, getMeta, setMeta, transact } from './db';
import {
  addCourierPayment, getOpenShift, getOrder, hasCourierPayment, putOrder, putShift,
} from './till-repo';

/** The two writes that never had an API route: they go straight to Supabase. */
export const ADD_ORDER = 'supabase:addOrder';
export const MARK_READY = 'supabase:markStationReady';
export const UNMARK_READY = 'supabase:unmarkStationReady';

export interface WriteResult {
  ok: boolean;
  /** Why the till refused — same vocabulary the routes answer with. */
  error?: string;
}

const CLOSED = new Set(['ödənilib', 'ləğv edildi', 'silinib']);

// ── The outbox ───────────────────────────────────────────────────────────────

// Sequence numbers must climb forever, not restart when the queue drains. A
// counter in meta survives that, and survives the power cut that emptied it.
function nextSeq(): number {
  const handle = db();
  const next = Number(getMeta(handle, 'outbox_seq') ?? 0) + 1;
  setMeta(handle, 'outbox_seq', String(next));
  return next;
}

function enqueue(id: string, kind: string, body: unknown, companyId: string): void {
  db()
    .prepare(
      `insert into outbox (id, seq, kind, body, company_id, queued_at, attempts)
       values (?, ?, ?, ?, ?, ?, 0)
       on conflict(id) do nothing`,
    )
    .run(id, nextSeq(), kind, JSON.stringify(body), companyId, new Date().toISOString());
}

/** Has this exact write already been recorded? A retry, not a second write. */
function alreadyQueued(id: string): boolean {
  return db().prepare('select 1 as hit from outbox where id = ?').get(id) !== undefined;
}

export function outboxCount(): number {
  return Number(db().prepare('select count(*) as n from outbox').get()?.n ?? 0);
}

export interface OutboxEntry {
  id: string;
  seq: number;
  kind: string;
  body: unknown;
  companyId: string | null;
  queuedAt: string;
  attempts: number;
}

/** Oldest first — the order Supabase must see them in. */
export function outboxAll(): OutboxEntry[] {
  return db()
    .prepare('select * from outbox order by seq')
    .all()
    .map(r => ({
      id: String(r.id),
      seq: Number(r.seq),
      kind: String(r.kind),
      body: JSON.parse(String(r.body)),
      companyId: r.company_id === null || r.company_id === undefined ? null : String(r.company_id),
      queuedAt: String(r.queued_at),
      attempts: Number(r.attempts),
    }));
}

export function outboxDrop(id: string): void {
  db().prepare('delete from outbox where id = ?').run(id);
}

export function outboxAttempted(id: string): void {
  db().prepare('update outbox set attempts = attempts + 1 where id = ?').run(id);
}

// ── Applying one write ───────────────────────────────────────────────────────

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

// Every route in app/api/ scopes its update by company_id as well as by order id,
// so a forged request cannot reach another restaurant's bill. One machine only
// ever holds one restaurant, but the check costs nothing and its absence would be
// the kind of thing that stops being true the day two do.
function belongsTo(orderId: string, companyId: string): boolean {
  const row = db().prepare('select company_id from orders where id = ?').get(orderId);
  return String(row?.company_id ?? '') === companyId;
}

/** The order this write is about, if it is still open to being written to. */
function openOrder(orderId: string, companyId: string): Order | { error: string } {
  const order = getOrder(orderId);
  if (!order || !belongsTo(orderId, companyId)) return { error: 'not_found' };
  if (CLOSED.has(order.status)) return { error: 'closed' };
  return order;
}

// Mirrors lib/store.ts addOrder and the insert the seller screen makes.
//
// The ids are the interesting part. Supabase would mint its own for each
// order_items row, and until a sync brought them back the till would be holding
// lines it cannot name — so "remove one Cola" from an order taken during an
// outage would have nothing to remove. So the till names them, here, once, and
// the replay carries those names to the server. Local row and remote row are the
// same row, exactly as the order's own id already is.
function applyAddOrder(body: Record<string, unknown>, companyId: string): WriteResult {
  const order = body as unknown as Order;
  if (!order?.id || !Array.isArray(order.items)) return { ok: false, error: 'bad_order' };

  const stamped: Order = {
    ...order,
    // This machine numbers its own orders, and the number it picks is final: the
    // replay carries it to Supabase and the counter there is moved past it
    // rather than over it. It has to work that way, because the number is
    // printed on the guest's receipt and on the kitchen slip the moment the
    // order is taken — minutes or hours before Supabase hears about it. A server
    // that renumbered the order afterwards would leave the paper in the
    // restaurant disagreeing with the report at the end of the night, with no
    // way to tell which bill was which.
    orderNumber: order.orderNumber || nextOrderNumber(companyId),
    // Which counter numbered it. Only meaningful because the line above picked
    // the number locally: a second till, offline at the same time, will pick the
    // same one, and this is what keeps the two receipts apart.
    tillNumber: order.tillNumber ?? thisTillNumber(),
    items: order.items.map(withId(order.createdAt)),
  };

  putOrder(companyId, stamped);
  enqueue(`order:${stamped.id}`, ADD_ORDER, stamped, companyId);
  return { ok: true };
}

function withId(createdAt: string) {
  return (oi: OrderItem): OrderItem => ({
    ...oi,
    id: oi.id ?? crypto.randomUUID(),
    createdAt: oi.createdAt ?? createdAt,
  });
}

/**
 * Which till this machine is, from the terminal link it was set up with.
 *
 * Read here rather than passed in from the page, so there is one answer per
 * machine and no way for a renderer to claim to be a different counter. A
 * machine signed in with an account has no link and is till 1 — the same
 * assumption it has always made by having no number at all.
 */
function thisTillNumber(): number {
  try {
    const raw = getMeta(db(), 'terminal_link');
    if (!raw) return 1;
    const n = Math.trunc(Number((JSON.parse(raw) as { tillNumber?: unknown }).tillNumber));
    return Number.isFinite(n) && n >= 1 && n <= 9 ? n : 1;
  } catch {
    return 1;
  }
}

function nextOrderNumber(companyId: string): number {
  const row = db()
    .prepare('select coalesce(max(order_number), 0) as n from orders where company_id = ?')
    .get(companyId);
  return Number(row?.n ?? 0) + 1;
}

// Mirrors app/api/add-order-items/route.ts.
function applyAddItems(id: string, body: Record<string, unknown>, companyId: string): WriteResult {
  const orderId = str(body.orderId);
  const items = Array.isArray(body.items) ? (body.items as OrderItem[]) : null;
  if (!orderId || !items?.length) return { ok: false, error: 'bad_request' };

  const found = openOrder(orderId, companyId);
  if ('error' in found) return { ok: false, error: found.error };

  const now = new Date().toISOString();
  const added = items.map(withId(now));
  const note = typeof body.note === 'string' ? body.note : undefined;

  putOrder(companyId, {
    ...found,
    items: [...found.items, ...added],
    // undefined leaves the note alone; '' clears it, as the route does.
    note: note === undefined ? found.note : note || undefined,
  });

  // The ids travel with the body so the server's rows carry them too.
  enqueue(id, '/api/add-order-items', { ...body, items: added, companyId }, companyId);
  return { ok: true };
}

// Mirrors app/api/update-order-item-qty/route.ts, ghost row and all.
//
// A partial decrement is two changes, not one: the line drops to its new
// quantity, and a *separate* already-removed line carrying the difference is
// added. That ghost is what the order card strikes through and what the
// kitchen's "cancel 1 Cola" slip is printed from, so a local apply that only
// changed the number would lose the paper trail the waiter is judged on.
function applyItemQty(id: string, body: Record<string, unknown>, companyId: string): WriteResult {
  const orderId = str(body.orderId);
  const orderItemId = str(body.orderItemId);
  const quantity = num(body.quantity, -1);
  if (!orderId || !orderItemId || quantity < 0) return { ok: false, error: 'bad_request' };

  const found = openOrder(orderId, companyId);
  if ('error' in found) return { ok: false, error: found.error };

  const line = found.items.find(x => x.id === orderItemId);
  if (!line) return { ok: false, error: 'not_found' };

  const now = new Date().toISOString();
  const by = str(body.removedBy) ?? 'Satıcı';
  const removedItems = found.removedItems ?? [];

  if (quantity <= 0) {
    putOrder(companyId, {
      ...found,
      items: found.items.filter(x => x.id !== orderItemId),
      removedItems: [...removedItems, { ...line, removedAt: now, removedBy: by }],
    });
  } else {
    const taken = line.quantity - quantity;
    putOrder(companyId, {
      ...found,
      items: found.items.map(x => (x.id === orderItemId ? { ...x, quantity } : x)),
      removedItems:
        taken > 0
          ? [...removedItems, { ...line, id: crypto.randomUUID(), quantity: taken, createdAt: now, removedAt: now, removedBy: by }]
          : removedItems,
    });
  }

  enqueue(id, '/api/update-order-item-qty', { ...body, companyId }, companyId);
  return { ok: true };
}

// Mirrors app/api/remove-order-item/route.ts — the whole line, soft-deleted.
function applyRemoveItem(id: string, body: Record<string, unknown>, companyId: string): WriteResult {
  return applyItemQty(id, { ...body, quantity: 0 }, companyId);
}

// Mirrors app/api/update-order-status/route.ts.
//
// The route's `.neq('status','ödənilib')` guard is what stops a second tap
// charging the guest twice; the same guard has to live here, because here is
// where the tap now lands.
function applyStatus(id: string, body: Record<string, unknown>, companyId: string): WriteResult {
  const orderId = str(body.orderId);
  const status = str(body.status) as Order['status'] | undefined;
  if (!orderId || !status) return { ok: false, error: 'bad_request' };

  const order = getOrder(orderId);
  if (!order || !belongsTo(orderId, companyId)) return { ok: false, error: 'not_found' };
  // Not the full CLOSED set: 'silinib' can still be given a status back, which is
  // how the admin panel restores a deleted order. Paid and cancelled cannot —
  // that guard is what stops a second tap charging the guest twice.
  if (order.status === 'ödənilib' || order.status === 'ləğv edildi') return { ok: false, error: 'closed' };

  const hasAmounts =
    body.cashAmount !== undefined || body.cardAmount !== undefined || body.changeAmount !== undefined;

  const next: Order = {
    ...order,
    status,
    ...(hasAmounts
      ? {
          cashAmount: num(body.cashAmount),
          cardAmount: num(body.cardAmount),
          changeAmount: num(body.changeAmount),
          discountAmount: num(body.discountAmount) || undefined,
          discountType: (str(body.discountType) as '%' | '₼') ?? '₼',
          // Without this a delivery closed on debt reads locally as paid with
          // nothing owed, and the Kuryerlər screen understates the balance
          // until the next pull — during an outage, indefinitely.
          courierDebt: num(body.courierDebt) || undefined,
        }
      : {}),
    ...(status === 'ödənilib' ? { paidAt: new Date().toISOString() } : {}),
  };

  putOrder(companyId, next);
  enqueue(id, '/api/update-order-status', { ...body, companyId }, companyId);
  return { ok: true };
}

// Mirrors app/api/cancel-order/route.ts.
function applyCancel(id: string, body: Record<string, unknown>, companyId: string): WriteResult {
  const orderId = str(body.orderId);
  const reason = str(body.reason);
  const by = str(body.by);
  if (!orderId || !reason || !by) return { ok: false, error: 'bad_request' };

  const found = openOrder(orderId, companyId);
  if ('error' in found) return { ok: false, error: found.error };

  putOrder(companyId, {
    ...found,
    status: 'ləğv edildi',
    cancelledAt: new Date().toISOString(),
    cancelledBy: by,
    cancelReason: reason,
  });
  enqueue(id, '/api/cancel-order', { ...body, companyId }, companyId);
  return { ok: true };
}

// Mirrors app/api/move-table/route.ts. The table must be one of this
// restaurant's own — the route proves that against the database and so does
// this, because the till's copy of the room is the same room.
function applyMove(id: string, body: Record<string, unknown>, companyId: string): WriteResult {
  const orderId = str(body.orderId);
  const tableId = num(body.tableId, -1);
  if (!orderId || tableId < 0) return { ok: false, error: 'bad_request' };

  const table = db()
    .prepare('select 1 as hit from tables where id = ? and company_id = ?')
    .get(tableId, companyId);
  if (!table) return { ok: false, error: 'table' };

  const found = openOrder(orderId, companyId);
  if ('error' in found) return { ok: false, error: found.error };

  putOrder(companyId, { ...found, tableNumber: tableId });
  enqueue(id, '/api/move-table', { ...body, companyId }, companyId);
  return { ok: true };
}

// ── The drawer ───────────────────────────────────────────────────────────────

// Mirrors app/api/open-shift/route.ts, which already honours an id and a time
// chosen by the till precisely so this can happen with no line at all.
function applyOpenShift(id: string, body: Record<string, unknown>, companyId: string): WriteResult {
  const shiftId = str(body.shiftId);
  const openedBy = str(body.openedBy);
  if (!shiftId || !openedBy) return { ok: false, error: 'bad_request' };

  const already = getOpenShift(companyId);
  if (already && already.id !== shiftId) return { ok: false, error: 'already_open' };

  putShift(companyId, {
    id: shiftId,
    openedAt: str(body.openedAt) ?? new Date().toISOString(),
    openedBy,
    openingCash: num(body.openingCash),
    movements: [],
    edits: [],
  });
  enqueue(id, '/api/open-shift', { ...body, companyId }, companyId);
  return { ok: true };
}

// Mirrors app/api/add-shift-movement/route.ts. append_shift_movement appends
// unconditionally on the server, so the id in the outbox key is the only thing
// standing between a replay and the drawer being short at close.
function applyMovement(id: string, body: Record<string, unknown>, companyId: string): WriteResult {
  const shiftId = str(body.shiftId);
  const movement = body.movement as ShiftMovement | undefined;
  if (!shiftId || !movement) return { ok: false, error: 'bad_request' };

  const shift = getOpenShift(companyId);
  if (!shift || shift.id !== shiftId) return { ok: false, error: 'not_found' };
  if (movement.id && shift.movements.some(m => m.id === movement.id)) return { ok: true };

  putShift(companyId, { ...shift, movements: [...shift.movements, movement] });
  enqueue(id, '/api/add-shift-movement', { ...body, companyId }, companyId);
  return { ok: true };
}

// Mirrors app/api/add-courier-payment/route.ts.
//
// Two things happen at once and both have to survive an outage: the courier's
// balance drops, and the cash lands in the drawer. The payment row is what the
// Kuryerlər screen reads back; the shift movement is what makes the drawer add
// up at close. The payment id guards both — it is the outbox key, the movement
// id and the local row's primary key, so a replay finds all three already there.
function applyCourierPayment(id: string, body: Record<string, unknown>, companyId: string): WriteResult {
  const paymentId = str(body.paymentId);
  const courierId = str(body.courierId);
  const amount = num(body.amount);
  if (!paymentId || !courierId || !amount || amount <= 0) return { ok: false, error: 'bad_request' };
  if (hasCourierPayment(paymentId)) return { ok: true };

  const createdAt = new Date().toISOString();
  const by = str(body.by) ?? '';
  const shiftId = str(body.shiftId);

  // The kassa module may be off, in which case there is no drawer to book into
  // and the payment stands on its own — the same rule the RPC applies.
  if (shiftId) {
    const shift = getOpenShift(companyId);
    if (!shift || shift.id !== shiftId) return { ok: false, error: 'not_found' };
    if (!shift.movements.some(m => m.id === paymentId)) {
      putShift(companyId, {
        ...shift,
        movements: [...shift.movements, {
          id: paymentId, at: createdAt, amount, reason: 'Kuryer ödənişi', by,
        }],
      });
    }
  }

  addCourierPayment(companyId, { id: paymentId, courierId, amount, createdAt, createdBy: by, shiftId });
  enqueue(id, '/api/add-courier-payment', { ...body, companyId }, companyId);
  return { ok: true };
}

// Mirrors app/api/return-courier-order/route.ts — the food came back.
//
// applyCancel refuses a closed order, and rightly so everywhere else. A courier
// order carrying debt is the one exception, and the conditions here are the same
// ones cancel_courier_order enforces on the server.
function applyCourierReturn(id: string, body: Record<string, unknown>, companyId: string): WriteResult {
  const orderId = str(body.orderId);
  const reason = str(body.reason);
  const by = str(body.by);
  if (!orderId || !reason || !by) return { ok: false, error: 'bad_request' };

  const order = getOrder(orderId);
  if (!order || !belongsTo(orderId, companyId)) return { ok: false, error: 'not_found' };
  if (order.status === 'ləğv edildi') return { ok: true };
  if (order.status !== 'ödənilib' || !order.courierId || !(order.courierDebt ?? 0)) {
    return { ok: false, error: 'not_courier_order' };
  }

  putOrder(companyId, {
    ...order,
    status: 'ləğv edildi',
    cancelledAt: new Date().toISOString(),
    cancelledBy: by,
    cancelReason: reason,
  });
  enqueue(id, '/api/return-courier-order', { ...body, companyId }, companyId);
  return { ok: true };
}

// Mirrors app/api/close-shift/route.ts.
//
// The seller screen refuses to close a shift while the line is down or the
// outbox is not empty, and it is right to: the expected-cash figure is built
// from sales the server has not been told about yet. This still applies the
// close locally first, so the till's own record matches what was sent.
function applyCloseShift(id: string, body: Record<string, unknown>, companyId: string): WriteResult {
  const shiftId = str(body.shiftId);
  const closedBy = str(body.closedBy);
  if (!shiftId || !closedBy) return { ok: false, error: 'bad_request' };

  const shift = getOpenShift(companyId);
  if (!shift || shift.id !== shiftId) return { ok: false, error: 'not_found' };

  const closed: CashShift = {
    ...shift,
    closedAt: new Date().toISOString(),
    closedBy,
    expectedCash: num(body.expectedCash),
    countedCash: num(body.countedCash),
    cardSales: body.cardSales === undefined ? undefined : num(body.cardSales),
    countedCard: body.countedCard === undefined ? undefined : num(body.countedCard),
  };
  putShift(companyId, closed);
  enqueue(id, '/api/close-shift', { ...body, companyId }, companyId);
  return { ok: true };
}

// ── Which sexes have finished ────────────────────────────────────────────────

function applyReady(id: string, body: Record<string, unknown>, companyId: string, on: boolean): WriteResult {
  const orderId = str(body.orderId);
  const stationId = str(body.stationId);
  if (!orderId || !stationId) return { ok: false, error: 'bad_request' };

  const handle = db();
  if (on) {
    handle
      .prepare(
        `insert into station_ready (order_id, station_id, company_id, ready_at, ready_by)
         values (?, ?, ?, ?, ?)
         on conflict(order_id, station_id) do update set
           ready_at = excluded.ready_at, ready_by = excluded.ready_by`,
      )
      .run(orderId, stationId, companyId, new Date().toISOString(), str(body.readyBy) ?? null);
  } else {
    handle.prepare('delete from station_ready where order_id = ? and station_id = ?').run(orderId, stationId);
  }

  enqueue(id, on ? MARK_READY : UNMARK_READY, { ...body, companyId }, companyId);
  return { ok: true };
}

// ── The one entry point ──────────────────────────────────────────────────────

/**
 * Apply one till write to this machine, and record it for Supabase.
 *
 * `id` is the idempotency key the renderer already generates for the queued
 * path — stable for a given logical write — so calling this twice with the same
 * key is a retry and does nothing the second time. The whole thing runs in one
 * transaction: an order that is on the screen is an order in the outbox, or
 * neither, never one without the other.
 */
export function applyWrite(
  id: string,
  kind: string,
  body: Record<string, unknown>,
  companyId: string,
): WriteResult {
  return transact(() => {
    if (alreadyQueued(id)) return { ok: true };

    switch (kind) {
      case ADD_ORDER:                       return applyAddOrder(body, companyId);
      case '/api/add-order-items':          return applyAddItems(id, body, companyId);
      case '/api/update-order-item-qty':    return applyItemQty(id, body, companyId);
      case '/api/remove-order-item':        return applyRemoveItem(id, body, companyId);
      case '/api/update-order-status':      return applyStatus(id, body, companyId);
      case '/api/cancel-order':             return applyCancel(id, body, companyId);
      case '/api/move-table':               return applyMove(id, body, companyId);
      case '/api/open-shift':               return applyOpenShift(id, body, companyId);
      case '/api/add-shift-movement':       return applyMovement(id, body, companyId);
      case '/api/add-courier-payment':      return applyCourierPayment(id, body, companyId);
      case '/api/return-courier-order':     return applyCourierReturn(id, body, companyId);
      case '/api/close-shift':              return applyCloseShift(id, body, companyId);
      case MARK_READY:                      return applyReady(id, body, companyId, true);
      case UNMARK_READY:                    return applyReady(id, body, companyId, false);
      // Anything else is a write this file has not been taught. Refusing is the
      // only honest answer: silently queuing it would leave the screen showing
      // a change the machine never made.
      default:                              return { ok: false, error: `unsupported:${kind}` };
    }
  });
}

import type { Order } from '@/types';
import type { StationReady } from './store';
import { coalesce } from './coalesce';

// Every realtime change used to make admin, the browser till and the kitchen
// screen download the last 200 orders with all their dishes, and every ready
// mark it had ever seen. Most of the egress was that. A change names its order,
// so a screen downloads that order (and its ready marks) and patches its list.

/** How many orders a screen keeps: the same window the full read loads. */
export const ORDER_WINDOW = 200;

type Change = { new?: Record<string, unknown> | null; old?: Record<string, unknown> | null };

/**
 * The order a realtime change is about, or null when it cannot say — then the
 * screen reloads in full. With RLS on, a delete's `old` holds only the primary
 * key: an order keeps its id and a ready mark its (order_id, station_id), but a
 * deleted dish row loses its order_id.
 */
export function changedOrderId(table: 'orders' | 'order_items' | 'order_station_ready', change: Change): string | null {
  const row = change.new && Object.keys(change.new).length > 0 ? change.new : change.old ?? {};
  const id = table === 'orders' ? row.id : row.order_id;
  return typeof id === 'string' && id !== '' ? id : null;
}

/**
 * The list with the asked orders replaced by their fresh copies. An asked order
 * the server no longer returns is gone (deleted, or no longer this company's).
 * Newest first, cut to `limit`, like the full read.
 */
export function patchOrders(list: Order[], ids: Iterable<string>, fresh: Order[], limit = ORDER_WINDOW): Order[] {
  const asked = new Set(ids);
  const merged = [...list.filter(o => !asked.has(o.id)), ...fresh.filter(o => asked.has(o.id))];
  merged.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return merged.slice(0, limit);
}

/** The ready marks with the asked orders' marks replaced by the fresh ones. */
export function patchReady(rows: StationReady[], ids: Iterable<string>, fresh: StationReady[]): StationReady[] {
  const asked = new Set(ids);
  return [...rows.filter(r => !asked.has(r.orderId)), ...fresh.filter(r => asked.has(r.orderId))];
}

/**
 * Gathers a burst of changes like `coalesce`, remembering which orders they
 * named. `fn` gets the ids, or null when any change could not name its order.
 */
export function gatherOrderIds(fn: (ids: Set<string> | null) => void, ms: number) {
  let ids = new Set<string>();
  let all = false;
  const soon = coalesce(() => {
    const got = all ? null : ids;
    ids = new Set();
    all = false;
    fn(got);
  }, ms);
  const add = (id: string | null) => {
    if (id === null) all = true;
    else ids.add(id);
    soon();
  };
  return Object.assign(add, {
    cancel: () => { soon.cancel(); ids = new Set(); all = false; },
  });
}

import { MenuItem, Order, OrderItem, Station } from '@/types';

// Which sex prepares a given item.
//
// This mirrors public.resolve_station_id() and the coalesce(...) the print_jobs
// triggers apply nine times over: an item with no sex of its own goes to the
// company's FIRST sex, never nowhere. The prep screen and the printed ticket must
// name the same sex for the same dish, or a cook reads one thing and the paper says
// another — so the rule is written once here and once in SQL, and nowhere else.
//
// `stations` must already be in the DB's order (position, created_at); fetchStations
// guarantees it.
export function resolveStationId(
  itemStationId: string | null | undefined,
  stations: Station[],
): string | null {
  return itemStationId ?? stations[0]?.id ?? null;
}

// The sex an order line belongs to.
//
// An order line only carries menu_item_id — its name and price are snapshots, and
// mapOrderItem() rebuilds a stub MenuItem with no stationId — so the live menu is
// what says where it's cooked.
//
// A menu item deleted after the order was rung up resolves to null, matching the
// triggers: their `join menu_items` finds nothing and no ticket is enqueued. The
// screen hides what the printer wouldn't print rather than inventing a sex for it.
export function stationForItem(
  item: OrderItem,
  menuById: Map<string, MenuItem>,
  stations: Station[],
): string | null {
  const menuItem = menuById.get(item.menuItem.id);
  if (!menuItem) return null;
  return resolveStationId(menuItem.stationId, stations);
}

export function menuIndex(menu: MenuItem[]): Map<string, MenuItem> {
  return new Map(menu.map(m => [m.id, m]));
}

// Every sex with something to prepare on this order. Removed lines don't count —
// a cancelled dish is not work — but a sex whose only line was removed still needs
// to see the strike-through, which is handled by the card filter, not here.
export function stationsInOrder(
  order: Pick<Order, 'items'>,
  menuById: Map<string, MenuItem>,
  stations: Station[],
): Set<string> {
  const ids = new Set<string>();
  for (const item of order.items) {
    const id = stationForItem(item, menuById, stations);
    if (id) ids.add(id);
  }
  return ids;
}

// Which sexes have genuinely finished their part of this order.
//
// A ready row is not the whole answer. The bar says "done" at 14:00, the seller adds
// a beer at 14:10 — the row still sits there, so the beer would show green on the
// receipt and the bar's card would stay hidden. Nobody would ever make it.
//
// So a sex counts as ready only while no work of its own has landed since it said so.
// Derived from the rows' own timestamps rather than by deleting the ready row: every
// device agrees, a refresh doesn't forget, and marking ready again after the beer is
// poured restores it without anything having been destroyed.
//
// Removals don't invalidate — a sex with less to do than before is still done.
export function readyStationIds(
  order: Pick<Order, 'id' | 'items'>,
  readyRows: { orderId: string; stationId: string; readyAt: string }[],
  menuById: Map<string, MenuItem>,
  stations: Station[],
): Set<string> {
  const out = new Set<string>();
  for (const row of readyRows) {
    if (row.orderId !== order.id) continue;
    const readyMs = Date.parse(row.readyAt);
    // Instants, never strings: Postgres hands back "…41.208873+00:00" where an
    // optimistic local write makes "…41.000Z", and the two sort differently inside
    // the same second.
    const stale = order.items.some(item => {
      if (stationForItem(item, menuById, stations) !== row.stationId) return false;
      const addedMs = item.createdAt ? Date.parse(item.createdAt) : NaN;
      return !Number.isNaN(addedMs) && !Number.isNaN(readyMs) && addedMs > readyMs;
    });
    if (!stale) out.add(row.stationId);
  }
  return out;
}

// This sex's share of an order: its active lines and its removed lines.
export function sliceForStation(
  order: Pick<Order, 'items' | 'removedItems'>,
  stationId: string,
  menuById: Map<string, MenuItem>,
  stations: Station[],
): { items: OrderItem[]; removedItems: OrderItem[] } {
  const mine = (i: OrderItem) => stationForItem(i, menuById, stations) === stationId;
  return {
    items: order.items.filter(mine),
    removedItems: (order.removedItems ?? []).filter(mine),
  };
}

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
  const menuItem = menuById.get(String(item.menuItem.id));
  if (!menuItem) return null;
  return resolveStationId(menuItem.stationId, stations);
}

// What a line is to the sexes. A dish is itself, at its own sex. A set is what
// is inside it, each part at the sex that makes it: "Plov (Set 1)" in the
// kitchen and "Ayran (Set 1)" at the bar, with the set's count times the part's.
// A set whose parts were all deleted since goes whole to its own sex, so it is
// never lost. public.prep_lines() is the same rule in SQL, for the server's
// tickets; the two must name the same sexes.
//
// A part keeps the line's id with ":<n>" after it, so a screen can key on it.
export function prepLines(
  item: OrderItem,
  menuById: Map<string, MenuItem>,
  stations: Station[],
): { stationId: string; item: OrderItem }[] {
  const menuItem = menuById.get(String(item.menuItem.id));
  if (!menuItem) return [];
  const parts = (menuItem.setItems ?? []).flatMap((p, n) => {
    const inside = menuById.get(String(p.id));
    const stationId = inside && resolveStationId(inside.stationId, stations);
    if (!inside || !stationId) return [];
    const size = p.variantId ? inside.variants?.find(v => v.id === p.variantId) : undefined;
    return [{
      stationId,
      item: {
        ...item,
        id: item.id ? `${item.id}:${n}` : undefined,
        menuItem: { ...inside, name: `${inside.name}${size ? ` · ${size.name}` : ''} (${item.menuItem.name})` },
        quantity: item.quantity * Math.max(1, p.qty),
      },
    }];
  });
  if (parts.length > 0) return parts;
  const own = resolveStationId(menuItem.stationId, stations);
  return own ? [{ stationId: own, item }] : [];
}

// Whether a line is on the counter: every sex it went to has said so. A set is
// ready when the kitchen's plov and the bar's ayran both are.
export function lineReady(
  item: OrderItem,
  ready: Set<string>,
  menuById: Map<string, MenuItem>,
  stations: Station[],
): boolean {
  const ids = stationsForItem(item, menuById, stations);
  return ids.length > 0 && ids.every(id => ready.has(id));
}

// Every sex a line goes to: one for a dish, one or more for a set.
export function stationsForItem(
  item: OrderItem,
  menuById: Map<string, MenuItem>,
  stations: Station[],
): string[] {
  return [...new Set(prepLines(item, menuById, stations).map(l => l.stationId))];
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
    for (const id of stationsForItem(item, menuById, stations)) ids.add(id);
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
      if (!stationsForItem(item, menuById, stations).includes(row.stationId)) return false;
      const addedMs = item.createdAt ? Date.parse(item.createdAt) : NaN;
      return !Number.isNaN(addedMs) && !Number.isNaN(readyMs) && addedMs > readyMs;
    });
    if (!stale) out.add(row.stationId);
  }
  return out;
}

// This sex's share of an order: its active lines and its removed lines. A set
// comes as the parts made here (prepLines), not as the set.
//
// `since` is this sex's last ready_at, when it has one. A card only re-opens
// because work landed after that instant (see readyStationIds), and re-showing
// what was already made is how a cook makes the same dish twice — so anything
// batched at or before `since` is dropped and the card shows only the new work.
// No ready row → no cutoff → the whole slice, exactly as before.
export function sliceForStation(
  order: Pick<Order, 'items' | 'removedItems' | 'createdAt'>,
  stationId: string,
  menuById: Map<string, MenuItem>,
  stations: Station[],
  since?: string | null,
): { items: OrderItem[]; removedItems: OrderItem[] } {
  const mine = (list: OrderItem[]) => list.flatMap(i =>
    prepLines(i, menuById, stations).filter(l => l.stationId === stationId).map(l => l.item));

  const sinceMs = since ? Date.parse(since) : NaN;
  // Fail open: an unparseable time on either side keeps the line rather than
  // hiding real work. Null createdAt falls back to the order's own time, the
  // same original-batch stand-in itemBatches uses for pre-migration rows.
  const stillOpen = (i: OrderItem) => {
    if (Number.isNaN(sinceMs)) return true;
    const addedMs = Date.parse(i.createdAt ?? order.createdAt);
    if (Number.isNaN(addedMs)) return true;
    return addedMs > sinceMs;
  };
  return {
    items: mine(order.items).filter(stillOpen),
    removedItems: mine(order.removedItems ?? []).filter(stillOpen),
  };
}

// order_items.printed_station_id, from whatever a client sent. The column is a
// uuid, so anything else would fail the whole insert and lose the order over a
// hint that only saves a duplicate ticket.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function printedStationColumn(v: unknown): string | null {
  return typeof v === 'string' && UUID.test(v) ? v : null;
}

// The stations a note slip already came out at, from an untrusted body. Anything
// that isn't a station id is dropped; the worst that costs is a second slip.
export function printedStationList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(printedStationColumn).filter((x): x is string => x !== null) : [];
}

// order_items.printed_station_ids: every sex the till printed a line at. A set
// goes to more than one, and one id would leave the others to print it again.
export function printedStationsColumn(v: unknown): string[] | null {
  const ids = printedStationList(v);
  return ids.length > 0 ? ids : null;
}

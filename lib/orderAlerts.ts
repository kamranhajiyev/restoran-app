// What changed in the orders list, from the kitchen's point of view.
//
// Kept apart from the React page so it can be reasoned about — and tested —
// without a browser: two order lists in, "chime and/or beep" out.
//
// It diffs the list rather than reading realtime payloads, because every path —
// realtime push (authed) and the 40s poll (public terminal) — lands in the same
// setOrders. One mechanism covers both modes.

// itemId → quantity, per order id. Quantities, not just a set of ids: removing
// one unit of a dish ordered twice is an UPDATE, not a DELETE. The row survives,
// and an id-only diff hears nothing at all.
export type OrdersSnapshot = Map<string, Map<string, number>>;

export function snapshotOrders(
  orders: { id: string; items: { id?: string; quantity: number }[] }[],
): OrdersSnapshot {
  return new Map(
    // Items the server hasn't numbered yet (an optimistic append, mid-save) carry
    // no id and can't be diffed; they arrive for real on the next refresh.
    orders.map(o => [o.id, new Map(o.items.filter(i => !!i.id).map(i => [i.id!, i.quantity]))]),
  );
}

export interface OrderAlerts {
  newWork: boolean;   // a new order, or more of something on an open one
  removed: boolean;   // an item, or a unit of one, taken off an open order
}

// `isOwn(orderId)` mutes orders this device just changed — a waiter shouldn't be
// alerted by his own tap.
export function diffOrderAlerts(
  prev: OrdersSnapshot,
  next: OrdersSnapshot,
  isOwn: (orderId: string) => boolean = () => false,
): OrderAlerts {
  let newWork = false;
  let removed = false;

  for (const orderId of next.keys()) {
    if (!prev.has(orderId) && !isOwn(orderId)) newWork = true;
  }

  for (const [orderId, before] of prev) {
    const now = next.get(orderId);
    // An order missing from the new list fell off the end of the 200-row window as
    // newer ones arrived. That is not a removal.
    if (!now) continue;
    if (isOwn(orderId)) continue;

    // Items added to an already-open order are new work for the kitchen too — same
    // chime as a new order, or a waiter's "one more kebab" goes unheard.
    for (const [itemId, qty] of now) {
      const was = before.get(itemId);
      if (was === undefined || qty > was) newWork = true;
    }
    for (const [itemId, qty] of before) {
      const still = now.get(itemId) ?? 0;   // gone entirely, or fewer of them
      if (still < qty) removed = true;
    }
  }

  return { newWork, removed };
}

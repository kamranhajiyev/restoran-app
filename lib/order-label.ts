// How an order's number is written down, on screen and on paper.
//
// One counter per company numbers every order, and that was unambiguous for as
// long as the server was the only thing issuing numbers. The desktop till is
// not: with the line down it has to put a number on the guest's receipt and the
// kitchen slip the moment the order is taken, so it takes the next one it knows
// about locally. Two tills in one restaurant, both offline — which is the usual
// shape of an outage, since the internet dies for the whole building at once —
// can therefore both reach 45.
//
// The fix is not a bigger number. It is saying which till, and only when there
// is something to disambiguate:
//
//   till 1, or a server-numbered order  →  45
//   till 2                              →  45/2
//
// So a restaurant with one till — which is most of them — sees exactly what it
// has always seen, and nobody has to be taught anything new. Where two tills are
// running, the slash is the whole explanation.

import type { Order } from "@/types";

/** Below this, the till's number adds nothing: there is only one of it. */
const FIRST = 1;

/** The number as a human says it. No "№" — callers already print their own. */
export function orderLabel(order: Pick<Order, "orderNumber" | "tillNumber">): string {
  const till = order.tillNumber ?? 0;
  return till > FIRST ? `${order.orderNumber}/${till}` : String(order.orderNumber);
}

/**
 * The same, for the search box.
 *
 * A waiter looking for 45/2 types "45", and one looking at the paper may type
 * "45/2" — both have to find the order, so the haystack carries both spellings.
 */
export function orderSearchText(order: Pick<Order, "orderNumber" | "tillNumber">): string {
  const label = orderLabel(order);
  return label === String(order.orderNumber) ? label : `${order.orderNumber} ${label}`;
}

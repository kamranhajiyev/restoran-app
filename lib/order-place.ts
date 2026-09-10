// Where an order was going: a table, a courier, or the guest's own hands.
//
// There is no order-type column. The destination is inferred from what the
// order carries — a table id, a courier id, the online flag — and the inference
// has to be identical everywhere, because the seller's open-orders list and the
// admin's history are two views of the same rows. Written twice, the two would
// eventually disagree about the same order, and the one place that would show
// up is a report the owner is using to decide whether a rider is honest.
//
// So it lives here, like orderLabel does, and both screens call it.

import type { Order, RestaurantTable } from '@/types';

/** The three destinations, for filtering. Naming them is `orderPlace`'s job. */
export type PlaceKind = 'masa' | 'delivery' | 'takeaway';

/** What the company actually runs. Both toggles off is a valid setup — a shop
 *  that only ever hands food across the counter. */
export interface PlaceConfig {
  tables: Pick<RestaurantTable, 'id' | 'name'>[];
  tablesOn: boolean;
  deliveryOn: boolean;
}

type PlaceOrder = Pick<Order, 'tableNumber' | 'courierId' | 'online'>;

export function orderPlaceKind(order: PlaceOrder, cfg: Pick<PlaceConfig, 'deliveryOn'>): PlaceKind {
  if (order.tableNumber) return 'masa';
  // A courier is assigned when the seller takes a delivery; a link order has no
  // courier until someone is sent, and is a delivery from the moment it lands.
  // Both read the same to the waiter, so both get the same word.
  if (cfg.deliveryOn && (order.courierId || order.online)) return 'delivery';
  return 'takeaway';
}

/**
 * What gets written beside the order number. A table names itself; everything
 * else has to be spelled out, because a row with nothing next to the number is
 * the one thing a waiter cannot act on.
 *
 * Nothing at all is correct in exactly one case — the company that runs neither
 * tables nor delivery. There the seller is never asked, every order is the same
 * kind, and a word repeated on every row would say nothing.
 */
export function orderPlace(order: PlaceOrder, cfg: PlaceConfig): string {
  const kind = orderPlaceKind(order, cfg);
  if (kind === 'masa') {
    return cfg.tables.find(t => t.id === order.tableNumber)?.name ?? `Masa ${order.tableNumber}`;
  }
  if (kind === 'delivery') return 'Çatdırılma';
  return cfg.tablesOn || cfg.deliveryOn ? 'Takeaway' : '';
}

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

import type { Order, RestaurantTable } from '../types';

/** The words for an order with no table — on the screen and on every ticket,
 *  so the kitchen reads what the till shows. */
export const PLACE_WORDS = {
  online: 'Onlayn sifariş',
  delivery: 'Çatdırılma',
  takeaway: 'Takeaway',
} as const;

/** The destinations, for filtering. Naming them is `orderPlace`'s job. */
export type PlaceKind = 'masa' | 'delivery' | 'online' | 'takeaway';

/** What the company actually runs. Both toggles off is a valid setup — a shop
 *  that only ever hands food across the counter. */
export interface PlaceConfig {
  tables: Pick<RestaurantTable, 'id' | 'name'>[];
  tablesOn: boolean;
  deliveryOn: boolean;
}

type PlaceOrder = Pick<Order, 'tableNumber' | 'courierId' | 'online'> & Partial<Pick<Order, 'tableName'>>;

export function orderPlaceKind(order: PlaceOrder, cfg: Pick<PlaceConfig, 'deliveryOn'>): PlaceKind {
  if (order.tableNumber) return 'masa';
  // A guest who ordered through the menu link is told apart from a delivery the
  // seller took on the phone: nobody at the counter has spoken to them yet.
  if (order.online) return 'online';
  // A courier is assigned when the seller takes a delivery; a link order has no
  // courier until someone is sent, and is a delivery from the moment it lands.
  // Both read the same to the waiter, so both get the same word.
  if (cfg.deliveryOn && (order.courierId || order.online)) return 'delivery';
  return 'takeaway';
}

/**
 * A table as people call it, from the id an order carries.
 *
 * The id is only a row number. A restaurant that deleted its first fifty tables
 * and made new ones has "Masa 1" at id 51, and paper that printed the id sent
 * the cook to a table that does not exist. A bare number for a name ("1") gets
 * the word in front of it; a name that already says what it is ("Masa 1",
 * "Terras 3") is left alone. The id is the fallback only when the table is gone.
 *
 * `saved` is the name the order kept (Order.tableName). It wins over the
 * table's current name, so a rename or a deleted table leaves history alone.
 */
export function tableTitle(tables: Pick<RestaurantTable, 'id' | 'name'>[], id: number, saved?: string): string {
  const name = (saved?.trim() || tables.find(t => t.id === id)?.name)?.trim();
  if (!name) return `Masa ${id}`;
  return /^\d+$/.test(name) ? `Masa ${name}` : name;
}

/** An order moved to another table. The name it kept was the old table's: it
 *  goes, and the screens read the new table until the server names it. */
export function movedToTable<T extends { tableNumber: number; tableName?: string }>(order: T, tableId: number): T {
  return { ...order, tableNumber: tableId, tableName: undefined };
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
    return order.tableName?.trim() || (cfg.tables.find(t => t.id === order.tableNumber)?.name ?? `Masa ${order.tableNumber}`);
  }
  if (kind === 'online') return PLACE_WORDS.online;
  if (kind === 'delivery') return PLACE_WORDS.delivery;
  return cfg.tablesOn || cfg.deliveryOn ? PLACE_WORDS.takeaway : '';
}

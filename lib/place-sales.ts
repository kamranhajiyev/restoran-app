// Statistika's "Satış tipləri": sales split by where the order went
// (Test Restoran asked, 2026-10-05). Uses orderPlaceKind, the rule behind the
// admin's Sifarişlər filter, so a row here and that filter always agree.

import type { Order, RestaurantTable } from '@/types';
import { orderPlaceKind, PLACE_WORDS, tableTitle, type PlaceKind } from './order-place';

const ROWS: { kind: PlaceKind; label: string }[] = [
  { kind: 'masa', label: 'Masa' },
  { kind: 'takeaway', label: PLACE_WORDS.takeaway },
  { kind: 'delivery', label: PLACE_WORDS.delivery },
  { kind: 'online', label: 'Onlayn' },
];

export interface PlaceSale { kind: PlaceKind; label: string; rev: number; count: number }

/** One row per kind that had an order, in a fixed order. The rows add up to
 *  the same total as `total` summed over `orders`. */
export function placeSales(
  orders: Order[],
  deliveryOn: boolean,
  total: (o: Order) => number,
): PlaceSale[] {
  const sums = new Map<PlaceKind, { rev: number; count: number }>();
  for (const o of orders) {
    const k = orderPlaceKind(o, { deliveryOn });
    const s = sums.get(k) ?? { rev: 0, count: 0 };
    s.rev += total(o);
    s.count += 1;
    sums.set(k, s);
  }
  return ROWS.flatMap(r => {
    const s = sums.get(r.kind);
    return s ? [{ ...r, ...s }] : [];
  });
}

/** The Masa row opened up: one row per table, by its name as the till shows it,
 *  highest sales first. Tables that share a name are one row. */
export function tableSales(
  orders: Order[],
  tables: Pick<RestaurantTable, 'id' | 'name'>[],
  total: (o: Order) => number,
): { name: string; rev: number; count: number }[] {
  const sums = new Map<string, { rev: number; count: number }>();
  for (const o of orders) {
    if (!o.tableNumber) continue;
    const name = tableTitle(tables, o.tableNumber);
    const s = sums.get(name) ?? { rev: 0, count: 0 };
    s.rev += total(o);
    s.count += 1;
    sums.set(name, s);
  }
  return [...sums].map(([name, s]) => ({ name, ...s })).sort((a, b) => b.rev - a.rev);
}

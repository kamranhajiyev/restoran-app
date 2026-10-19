'use client';

import { mergeLines } from '@/lib/add-again';
import { Order, OrderItem } from '@/types';

// The seller's view of an order: what is on the table now, one line per dish,
// however many times it was added. A table that ordered Fanta in three rounds
// reads "Fanta 4 əd", not three lines to add up. When each round came in is the
// admin's question, answered by OrderItemHistory — the seller can switch to it.
//
// A line is green only when every unit on it is done; a later round still
// cooking shows as "2/4 hazır", so merging never hides food that isn't ready.
export default function OrderItemsMerged({ order, isItemReady }: {
  order: Order;
  isItemReady?: (item: OrderItem) => boolean;
}) {
  const { lines } = mergeLines(order.items, [], {});
  const removed = order.removedItems ?? [];

  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        const oi = line.item;
        const ready = isItemReady
          ? line.rows.filter(r => isItemReady(r)).reduce((s, r) => s + r.quantity, 0)
          : 0;
        const allReady = ready > 0 && ready === line.quantity;
        return (
          <div
            key={oi.id ?? i}
            className={`flex justify-between text-sm py-0.5 ${allReady ? 'text-green-700 font-medium' : 'text-stone-700'}`}
          >
            <span className="flex-1">
              {allReady && <span className="mr-1">✓</span>}
              {oi.menuItem.name}
              {oi.modifiers && <span className="text-xs text-primary-600 ml-1">({oi.modifiers})</span>}
              {ready > 0 && !allReady && (
                <span className="text-xs font-semibold text-green-600 ml-1.5">{ready}/{line.quantity} hazır</span>
              )}
            </span>
            <span className={`mx-4 ${allReady ? 'text-green-600' : 'text-stone-500'}`}>{line.quantity} əd</span>
            <span className="font-medium">{(oi.menuItem.price * line.quantity).toFixed(2)} ₼</span>
          </div>
        );
      })}
      {/* Taken off: still shown, struck through and unpriced — it costs the guest
          nothing. Who and when is in the times view. */}
      {removed.map((oi, i) => (
        <div key={oi.id ?? `rm${i}`} className="flex justify-between text-sm py-0.5 text-stone-400">
          <span className="flex-1 line-through">
            {oi.menuItem.name}
            {oi.modifiers && <span className="text-xs ml-1">({oi.modifiers})</span>}
          </span>
          <span className="mx-4 line-through">{oi.quantity} əd</span>
          <span className="text-[11px] self-center">silindi</span>
        </div>
      ))}
    </div>
  );
}

'use client';

import { itemBatches } from '@/lib/order-items';
import { Order } from '@/types';

// The order's item list read as a history rather than a snapshot: what was ordered
// first, what was added later and when, and what was taken off — struck through and
// still there, rather than silently gone.
//
// Removed lines carry no price, because they cost the guest nothing. They live in
// order.removedItems and never in order.items, so no total can count them.
export default function OrderItemHistory({ order, tz }: { order: Order; tz: string }) {
  const batches = itemBatches(order);

  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit', timeZone: tz });

  return (
    <div className="space-y-1">
      {batches.map((batch, b) => (
        <div key={batch.at}>
          {/* Only later batches get a divider — the first one *is* the order. */}
          {!batch.isFirst && (
            <div className="flex items-center gap-2 pt-2 pb-1">
              <span className="h-px flex-1 bg-stone-200" />
              <span className="text-[11px] font-semibold text-stone-400 uppercase tracking-wide">
                Əlavə · {time(batch.at)}
              </span>
              <span className="h-px flex-1 bg-stone-200" />
            </div>
          )}

          {batch.items.map((oi, i) => (
            oi.removedAt ? (
              <div key={oi.id ?? `${b}-${i}`} className="flex justify-between text-sm py-0.5 text-stone-400">
                <span className="flex-1 line-through">
                  {oi.menuItem.name}
                  {oi.modifiers && <span className="text-xs ml-1">({oi.modifiers})</span>}
                </span>
                <span className="mx-4 line-through">{oi.quantity} əd</span>
                <span className="text-[11px] whitespace-nowrap self-center">
                  {time(oi.removedAt)}{oi.removedBy ? ` · ${oi.removedBy}` : ''}
                </span>
              </div>
            ) : (
              <div key={oi.id ?? `${b}-${i}`} className="flex justify-between text-sm text-stone-700 py-0.5">
                <span className="flex-1">
                  {oi.menuItem.name}
                  {oi.modifiers && <span className="text-xs text-primary-600 ml-1">({oi.modifiers})</span>}
                </span>
                <span className="text-stone-500 mx-4">{oi.quantity} əd</span>
                <span className="font-medium">{(oi.menuItem.price * oi.quantity).toFixed(2)} ₼</span>
              </div>
            )
          ))}
        </div>
      ))}
    </div>
  );
}

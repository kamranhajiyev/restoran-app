'use client';
import { Minus, Plus, Undo2 } from 'lucide-react';
import type { MenuItem, OrderItem } from '@/types';

// ── CartItems — shared between desktop sidebar and mobile sheet ───────────

export function CartItems({ cart, existingItems, removedItems, addToCart, removeFromCart, onDecrementExisting, pendingRemovals, onUnstageRemoval, onCommitRemovals, removing }: {
  cart: OrderItem[];
  existingItems?: OrderItem[];
  removedItems?: OrderItem[];
  addToCart: (item: MenuItem, mods?: string) => void;
  // price identifies the line: the same product with the same label can sit in the
  // cart at two prices if its set was re-priced between the two taps.
  removeFromCart: (itemId: string, mods?: string, price?: number) => void;
  onDecrementExisting?: (oi: OrderItem) => void;
  // Units staged for removal but not yet sent, keyed by order_items.id.
  pendingRemovals?: Record<string, number>;
  onUnstageRemoval?: (oi: OrderItem) => void;
  onCommitRemovals?: () => void;
  removing?: boolean;
}) {
  const staged = pendingRemovals ?? {};
  const stagedFor = (oi: OrderItem) => (oi.id ? staged[oi.id] ?? 0 : 0);
  const stagedTotal = (existingItems ?? []).reduce((s, oi) => s + stagedFor(oi), 0);
  // Active items only — removed lines cost the guest nothing. Staged units are already
  // discounted here so the total on screen is what the guest will actually pay.
  const existingTotal = (existingItems ?? [])
    .reduce((s, oi) => s + oi.menuItem.price * (oi.quantity - stagedFor(oi)), 0);
  return (
    <div className="space-y-3">
      {existingItems && existingItems.length > 0 && (
        <div className="pb-3 mb-1 border-b border-stone-200">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Mövcud</p>
            <p className="text-xs font-semibold text-stone-500">{existingTotal.toFixed(2)} ₼</p>
          </div>
          <ul className="space-y-1.5">
            {existingItems.map((oi, j) => {
              const off = stagedFor(oi);
              const left = oi.quantity - off;
              return (
              <li key={'ex' + j} className="flex items-center justify-between gap-2 text-sm text-stone-500">
                <span className={`flex-1 min-w-0 truncate ${left === 0 ? 'line-through text-stone-400' : ''}`}>
                  {oi.menuItem.name}
                  {oi.modifiers && <span className="text-xs text-primary-600 ml-1">({oi.modifiers})</span>}
                  {off > 0 && <span className="text-xs text-red-500 ml-1">−{off}</span>}
                </span>
                {onDecrementExisting && oi.id && left > 0 && (
                  <button
                    onClick={() => onDecrementExisting(oi)}
                    disabled={removing}
                    className="shrink-0 w-6 h-6 rounded-full bg-stone-100 hover:bg-stone-200 disabled:opacity-40 text-stone-600 flex items-center justify-center active:scale-90"
                    title="Bir ədəd azalt"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                )}
                {/* Staged units are not on the server yet, so taking them back costs nothing. */}
                {onUnstageRemoval && oi.id && off > 0 && (
                  <button
                    onClick={() => onUnstageRemoval(oi)}
                    disabled={removing}
                    className="shrink-0 w-6 h-6 rounded-full bg-stone-100 hover:bg-stone-200 disabled:opacity-40 text-stone-600 flex items-center justify-center active:scale-90"
                    title="Silinməni ləğv et"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <span className="shrink-0 text-xs w-8 text-center">{left} əd</span>
                <span className="shrink-0 w-14 text-right">{(oi.menuItem.price * left).toFixed(2)} ₼</span>
              </li>
              );
            })}
            {/* Already taken off the order: shown, not hidden, but with no minus button
                and no price — it costs the guest nothing and isn't in existingTotal. */}
            {(removedItems ?? []).map((oi, j) => (
              <li key={'rm' + j} className="flex items-center justify-between gap-2 text-sm text-stone-400">
                <span className="flex-1 min-w-0 truncate line-through">
                  {oi.menuItem.name}
                  {oi.modifiers && <span className="text-xs ml-1">({oi.modifiers})</span>}
                </span>
                <span className="shrink-0 text-xs w-8 text-center line-through">{oi.quantity} əd</span>
                <span className="shrink-0 w-14 text-right text-[11px]">silindi</span>
              </li>
            ))}
          </ul>
          {/* One press sends the whole batch, so five units off one line become a single
              struck-through row and a single cancel slip at the bar. */}
          {onCommitRemovals && stagedTotal > 0 && (
            <button
              onClick={onCommitRemovals}
              disabled={removing}
              className="mt-3 w-full bg-red-600 hover:bg-red-700 disabled:bg-stone-300 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {removing && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {removing ? 'Göndərilir...' : `Silinməni əlavə et (${stagedTotal})`}
            </button>
          )}
        </div>
      )}
      {existingItems && cart.length === 0 && (
        <p className="text-center text-stone-400 text-xs py-2">Əlavə etmək üçün məhsul seçin</p>
      )}
    <ul className="space-y-3">
      {cart.map(ci => (
        <li key={ci.menuItem.id + (ci.modifiers ?? '') + ci.menuItem.price} className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-stone-800 truncate">{ci.menuItem.name}</p>
            {ci.modifiers && <p className="text-xs text-primary-600 truncate">{ci.modifiers}</p>}
            <p className="text-xs text-stone-500">{ci.menuItem.price.toFixed(2)} ₼</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => removeFromCart(ci.menuItem.id, ci.modifiers, ci.menuItem.price)}
              className="w-7 h-7 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-600 flex items-center justify-center active:scale-90"
            >
              <Minus className="w-3 h-3" />
            </button>
            <span className="w-5 text-center text-sm font-semibold">{ci.quantity}</span>
            <button
              onClick={() => addToCart(ci.menuItem, ci.modifiers)}
              className="w-7 h-7 rounded-full bg-primary-100 hover:bg-primary-200 text-primary-700 flex items-center justify-center active:scale-90"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </li>
      ))}
    </ul>
    </div>
  );
}

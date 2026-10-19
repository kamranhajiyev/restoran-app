'use client';
import { Fragment } from 'react';
import { Minus, Plus, Undo2 } from 'lucide-react';
import type { MenuItem, OrderItem } from '@/types';
import { mergeLines, rowToGiveBack, rowToTakeFrom } from '@/lib/add-again';

// ── CartItems — shared between desktop sidebar and mobile sheet ───────────

export function CartItems({ cart, existingItems, removedItems, addToCart, removeFromCart, onDecrementExisting, addAgain, onTakeBackOne, pendingRemovals, onUnstageRemoval, onCommitRemovals, removing }: {
  cart: OrderItem[];
  existingItems?: OrderItem[];
  removedItems?: OrderItem[];
  addToCart: (item: MenuItem, mods?: string) => void;
  // price identifies the line: the same product with the same label can sit in the
  // cart at two prices if its set was re-priced between the two taps.
  removeFromCart: (itemId: string, mods?: string, price?: number) => void;
  onDecrementExisting?: (oi: OrderItem) => void;
  // One more of a line already on the order, as a new line in the cart. Returns
  // null when it can't be added again (the product is off the menu).
  addAgain?: (oi: OrderItem) => (() => void) | null;
  // "+" on a line with units waiting to come off takes one back instead.
  onTakeBackOne?: (oi: OrderItem) => void;
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
  // Adding to an order: a dish already on it shows once, with the new units on
  // the same line; only dishes not on it yet are listed below as new.
  const merged = existingItems ? mergeLines(existingItems, cart, staged) : null;
  const newLines = merged ? merged.extra : cart;
  return (
    <div className="space-y-3">
      {existingItems && existingItems.length > 0 && (
        <div className="pb-3 mb-1 border-b border-stone-200">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-stone-500 uppercase tracking-wide">Mövcud</p>
            <p className="text-sm font-semibold text-stone-500">{existingTotal.toFixed(2)} ₼</p>
          </div>
          <ul className="space-y-1.5">
            {merged!.lines.map((line, j) => {
              const oi = line.item;
              const left = line.quantity - line.off;
              const more = line.added.reduce((s, ci) => s + ci.quantity, 0);
              const lastAdded = line.added[line.added.length - 1];
              const takeFrom = onDecrementExisting ? rowToTakeFrom(line, staged) : null;
              // "−" takes back what this press would add before it touches what the
              // kitchen already has; "+" gives back a waiting removal before it adds
              // anything new. Either way the kitchen never gets a cancel slip and a
              // new ticket for the same dish.
              const minus = lastAdded
                ? () => removeFromCart(lastAdded.menuItem.id, lastAdded.modifiers, lastAdded.menuItem.price)
                : takeFrom ? () => onDecrementExisting!(takeFrom) : null;
              const giveBack = line.off > 0 && onTakeBackOne ? rowToGiveBack(line, staged) : null;
              const plus = giveBack ? () => onTakeBackOne!(giveBack)
                : lastAdded ? () => addToCart(lastAdded.menuItem, lastAdded.modifiers)
                : addAgain?.(oi) ?? null;
              return (
              <Fragment key={'ex' + j}>
              <li className="flex items-center justify-between gap-2 text-base text-stone-600">
                {/* Name in full, wrapping if it must; the size and the money go on the
                    small line under it, so a narrow panel never cuts the name to "Fan…". */}
                <div className="flex-1 min-w-0">
                  <p className={`break-words leading-tight ${left === 0 && more === 0 ? 'line-through text-stone-400' : ''}`}>
                    {oi.menuItem.name}
                    {line.off > 0 && <span className="text-sm font-semibold text-red-500 ml-1.5 whitespace-nowrap">−{line.off}</span>}
                    {more > 0 && <span className="text-sm font-semibold text-green-600 ml-1.5 whitespace-nowrap">+{more}</span>}
                  </p>
                  <p className="text-sm text-stone-500">
                    {oi.modifiers && <span className="text-primary-600">{oi.modifiers} · </span>}
                    {(oi.menuItem.price * left).toFixed(2)} ₼
                  </p>
                </div>
                {minus && (
                  <button
                    onClick={minus}
                    disabled={removing}
                    className="shrink-0 w-7 h-7 rounded-full bg-stone-100 hover:bg-stone-200 disabled:opacity-40 text-stone-600 flex items-center justify-center active:scale-90"
                    title="Bir ədəd azalt"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                )}
                {/* Staged units are not on the server yet, so taking them back costs nothing. */}
                {onUnstageRemoval && line.off > 0 && (
                  <button
                    onClick={() => line.rows.forEach(r => { if (stagedFor(r) > 0) onUnstageRemoval(r); })}
                    disabled={removing}
                    className="shrink-0 w-7 h-7 rounded-full bg-stone-100 hover:bg-stone-200 disabled:opacity-40 text-stone-600 flex items-center justify-center active:scale-90"
                    title="Silinməni ləğv et"
                  >
                    <Undo2 className="w-4 h-4" />
                  </button>
                )}
                <span className="shrink-0 text-sm w-10 text-center">{left} əd</span>
                {/* The extra goes into the new batch, not onto these rows: the kitchen
                    already has them, and only the extra should print. */}
                {plus && (
                  <button
                    onClick={plus}
                    disabled={removing}
                    className="shrink-0 w-7 h-7 rounded-full bg-primary-100 hover:bg-primary-200 disabled:opacity-40 text-primary-800 flex items-center justify-center active:scale-90"
                    title="Bir ədəd əlavə et"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                )}
              </li>
              {/* The same product in a size not on the order yet: new, so green, and
                  right here rather than under YENİ, so every Fanta reads together. */}
              {line.newSizes.map(ci => (
                <li key={'ns' + ci.menuItem.price + (ci.modifiers ?? '')} className="flex items-center justify-between gap-2 text-base text-green-700">
                  <div className="flex-1 min-w-0">
                    <p className="break-words leading-tight">
                      {ci.menuItem.name}
                      <span className="text-sm font-semibold ml-1.5 whitespace-nowrap">+{ci.quantity}</span>
                    </p>
                    <p className="text-sm text-green-600">
                      {ci.modifiers && <span>{ci.modifiers} · </span>}
                      {(ci.menuItem.price * ci.quantity).toFixed(2)} ₼
                    </p>
                  </div>
                  <button
                    onClick={() => removeFromCart(ci.menuItem.id, ci.modifiers, ci.menuItem.price)}
                    className="shrink-0 w-7 h-7 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-600 flex items-center justify-center active:scale-90"
                    title="Bir ədəd azalt"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="shrink-0 text-sm w-10 text-center">{ci.quantity} əd</span>
                  <button
                    onClick={() => addToCart(ci.menuItem, ci.modifiers)}
                    className="shrink-0 w-7 h-7 rounded-full bg-primary-100 hover:bg-primary-200 text-primary-800 flex items-center justify-center active:scale-90"
                    title="Bir ədəd əlavə et"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </li>
              ))}
              </Fragment>
              );
            })}
            {/* Already taken off the order: shown, not hidden, but with no minus button
                and no price — it costs the guest nothing and isn't in existingTotal. */}
            {(removedItems ?? []).map((oi, j) => (
              <li key={'rm' + j} className="flex items-center justify-between gap-2 text-base text-stone-400">
                <span className="flex-1 min-w-0 truncate line-through">
                  {oi.menuItem.name}
                  {oi.modifiers && <span className="text-sm ml-1">({oi.modifiers})</span>}
                </span>
                <span className="shrink-0 text-sm w-10 text-center line-through">{oi.quantity} əd</span>
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
      {/* Named like Mövcud above, so the seller can tell what the kitchen already
          has from what this press will send. */}
      {existingItems && existingItems.length > 0 && newLines.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-green-700 tracking-wide">YENİ</p>
          <p className="text-sm font-semibold text-green-700">{newLines.reduce((s, ci) => s + ci.menuItem.price * ci.quantity, 0).toFixed(2)} ₼</p>
        </div>
      )}
    <ul className="space-y-3">
      {newLines.map(ci => (
        <li key={ci.menuItem.id + (ci.modifiers ?? '') + ci.menuItem.price} className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-base font-medium text-stone-800 truncate">{ci.menuItem.name}</p>
            {ci.modifiers && <p className="text-sm text-primary-600 truncate">{ci.modifiers}</p>}
            <p className="text-sm text-stone-500">{ci.menuItem.price.toFixed(2)} ₼</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => removeFromCart(ci.menuItem.id, ci.modifiers, ci.menuItem.price)}
              className="w-7 h-7 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-600 flex items-center justify-center active:scale-90"
            >
              <Minus className="w-3 h-3" />
            </button>
            <span className="w-6 text-center text-base font-semibold">{ci.quantity}</span>
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

// A note on one line of the order — "şəkərsiz" on one coffee, not the whole table.
//
// It rides in order_items.modifiers after the picked options, as "Şərh: …". That
// text already reaches every kitchen ticket (the server's build_ticket, the exe
// and the browser till print it under the dish) and every screen, so the note
// needs no column of its own. Two lines with different notes stay two lines,
// because the cart only merges lines whose modifiers match.

import type { OrderItem } from '@/types';

const MARK = 'Şərh: ';
const SEP = ' · ';
export const ITEM_NOTE_MAX = 100;

/** Tidies what the seller typed: one line, no runs of spaces, not too long for a ticket. */
export function cleanItemNote(note: string): string {
  return note.replace(/\s+/g, ' ').trim().slice(0, ITEM_NOTE_MAX).trim();
}

/** Splits a line's modifiers into the picked options and the seller's note. */
export function splitItemNote(modifiers?: string | null): { options?: string; note?: string } {
  const text = modifiers ?? '';
  const at = text.startsWith(MARK) ? 0 : text.lastIndexOf(SEP + MARK);
  if (at < 0) return text ? { options: text } : {};
  const options = text.slice(0, at);
  const note = text.slice(at + (at === 0 ? 0 : SEP.length) + MARK.length);
  return { ...(options ? { options } : {}), ...(note ? { note } : {}) };
}

/**
 * The cart with `line`'s note set. A line that now matches another (same
 * product, options, note and price) folds into it, as a second tap would have.
 */
export function setCartLineNote(cart: OrderItem[], line: OrderItem, note: string): OrderItem[] {
  const same = (a: OrderItem, b: OrderItem) =>
    a.menuItem.id === b.menuItem.id && (a.modifiers ?? '') === (b.modifiers ?? '') && a.menuItem.price === b.menuItem.price;
  const target = cart.find(ci => same(ci, line));
  if (!target) return cart;
  const modifiers = withItemNote(target.modifiers, note);
  const changed: OrderItem = { ...target, modifiers };
  if (!modifiers) delete changed.modifiers;
  if ((target.modifiers ?? '') === (modifiers ?? '')) return cart;
  const twin = cart.find(ci => ci !== target && same(ci, changed));
  if (twin) {
    return cart
      .filter(ci => ci !== target)
      .map(ci => (ci === twin ? { ...ci, quantity: ci.quantity + target.quantity } : ci));
  }
  return cart.map(ci => (ci === target ? changed : ci));
}

/** The line's modifiers with its note replaced; an empty note takes it off. */
export function withItemNote(modifiers: string | null | undefined, note: string): string | undefined {
  const { options } = splitItemNote(modifiers);
  const clean = cleanItemNote(note);
  const out = [options, clean ? MARK + clean : ''].filter(Boolean).join(SEP);
  return out || undefined;
}


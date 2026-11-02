// A note for one dish, as Poster has it: "şəkərsiz" on one coffee of two. Until
// now the till had one note for the whole order (Natiq, 2026-11-02). The note
// rides in the line's modifiers, so it must stay apart from the options, keep
// lines with different notes apart, and reach the kitchen ticket under its dish.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { cleanItemNote, setCartLineNote, splitItemNote, withItemNote } from '@/lib/item-note';
import { buildStationTicket, type TicketPayload } from '@/lib/escpos';
import { CartItems } from '@/components/seller/CartItems';
import type { MenuItem, OrderItem } from '@/types';

const latte: MenuItem = { id: 'l', name: 'Latte', price: 5, category: 'Kofe', available: true };
const line = (q: number, modifiers?: string): OrderItem => ({ menuItem: latte, quantity: q, ...(modifiers ? { modifiers } : {}) });

describe('a note in the modifiers', () => {
  it('goes after the picked options and comes back apart', () => {
    expect(withItemNote('Böyük', 'şəkərsiz')).toBe('Böyük · Şərh: şəkərsiz');
    expect(splitItemNote('Böyük · Şərh: şəkərsiz')).toEqual({ options: 'Böyük', note: 'şəkərsiz' });
    expect(withItemNote(undefined, 'tez olsun')).toBe('Şərh: tez olsun');
    expect(splitItemNote('Şərh: tez olsun')).toEqual({ note: 'tez olsun' });
  });

  it('replaces the old note and leaves the options alone', () => {
    expect(withItemNote('Böyük · Şərh: şəkərsiz', 'buzlu')).toBe('Böyük · Şərh: buzlu');
    expect(withItemNote('Böyük · Şərh: şəkərsiz', '  ')).toBe('Böyük');
    expect(withItemNote('Şərh: şəkərsiz', '')).toBeUndefined();
  });

  it('keeps the note to one short line', () => {
    expect(cleanItemNote('  az\n  şəkər  ')).toBe('az şəkər');
    expect(cleanItemNote('x'.repeat(300)).length).toBe(100);
  });
});

describe('notes in the cart', () => {
  it('splits a line off once it has its own note', () => {
    const cart = [line(1, 'Şərh: şəkərsiz'), line(2)];
    expect(setCartLineNote(cart, cart[1], 'buzlu')).toEqual([line(1, 'Şərh: şəkərsiz'), line(2, 'Şərh: buzlu')]);
  });

  it('folds two lines together when their notes become the same', () => {
    const cart = [line(1, 'Şərh: şəkərsiz'), line(2)];
    expect(setCartLineNote(cart, cart[0], '')).toEqual([line(3)]);
  });

  it('shows the Şərh button on each new line', () => {
    const html = renderToStaticMarkup(createElement(CartItems, {
      cart: [line(1)], addToCart: () => {}, removeFromCart: () => {}, onSetNote: () => {},
    }));
    expect(html).toContain('Şərh');
  });
});

describe('the kitchen ticket', () => {
  it('prints the note under its dish', () => {
    const p: TicketPayload = {
      kind: 'new', station: 'Bar', orderNumber: 7, table: null, at: '2026-11-02T10:00:00Z',
      items: [{ name: 'Latte', qty: 1, modifiers: withItemNote(undefined, 'buzlu') }],
    } as TicketPayload;
    const text = new TextDecoder('latin1').decode(buildStationTicket(p));
    expect(text).toMatch(/Latte[\s\S]{0,20}rh: buzlu/);
  });
});


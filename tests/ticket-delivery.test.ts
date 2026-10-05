// An order from the menu link printed "Takeaway" on the kitchen ticket, and the
// food went to the counter instead of out for delivery (Latte Art, 2026-10-05).
// The owner asked for the ticket to say what the till's screen says.

import { describe, expect, it } from 'vitest';
import { placeLines, type TicketPayload } from '@/lib/escpos';
import { orderPlace } from '@/lib/order-place';

const base: TicketPayload = {
  kind: 'new', station: 'Mətbəx', orderNumber: 7, table: null, waiter: null,
  at: '2026-10-05T10:00:00Z', items: [{ name: 'Dolma', qty: 1 }],
};
const place = (t: number) => `Masa ${t}`;
const screen = (o: { tableNumber?: number; courierId?: string; online?: boolean }) =>
  orderPlace({ tableNumber: 0, ...o }, { tables: [], tablesOn: true, deliveryOn: true });

describe('where the ticket sends the food', () => {
  it('a menu-link order says what the screen says', () => {
    expect(placeLines({ ...base, online: true }, place)).toEqual([screen({ online: true })]);
  });

  it('a menu-link order with a rider names him too', () => {
    expect(placeLines({ ...base, online: true, courier: 'Elvin' }, place))
      .toEqual([screen({ online: true, courierId: 'k1' }), 'Kuryer: Elvin']);
  });

  it('a courier order says what the screen says, and names the rider', () => {
    expect(placeLines({ ...base, courier: 'Elvin' }, place)).toEqual([screen({ courierId: 'k1' }), 'Kuryer: Elvin']);
  });

  it('a counter order says what the screen says', () => {
    expect(placeLines(base, place)).toEqual([screen({})]);
  });

  it('a table order names the table', () => {
    expect(placeLines({ ...base, table: 3 }, place)).toEqual(['Masa 3']);
  });
});

describe('the admin history filter', () => {
  const cfg = { deliveryOn: true };
  it('keeps menu-link orders apart from phone deliveries', async () => {
    const { orderPlaceKind } = await import('@/lib/order-place');
    expect(orderPlaceKind({ tableNumber: 0, online: true }, cfg)).toBe('online');
    expect(orderPlaceKind({ tableNumber: 0, online: true, courierId: 'k1' }, cfg)).toBe('online');
    expect(orderPlaceKind({ tableNumber: 0, courierId: 'k1' }, cfg)).toBe('delivery');
    expect(orderPlaceKind({ tableNumber: 0 }, cfg)).toBe('takeaway');
    expect(orderPlaceKind({ tableNumber: 4 }, cfg)).toBe('masa');
  });
});

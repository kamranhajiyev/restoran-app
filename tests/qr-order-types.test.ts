// 2026-10-31: owners print or share a QR for an order type (Banket, Xarici…)
// and want guests to see that type's prices. Before, the QR menu and
// /api/guest-order always used the plain menu prices, so a Masa +10% was
// charged at the till but not on a QR order.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { guestMenuLink, guestOrderType, priceGuestLines, type MenuRow } from '@/lib/guest-order';
import { DEFAULT_ORDER_TYPES, typedPrice, type OrderType } from '@/lib/order-types';

const plus10: OrderType['change'] = { sign: 1, amount: 10, unit: '%' };
const types: OrderType[] = [
  { ...DEFAULT_ORDER_TYPES[0], change: plus10 },
  DEFAULT_ORDER_TYPES[1],
  DEFAULT_ORDER_TYPES[2],
  { id: 'banket', name: 'Banket', on: true, needsTable: false, change: { sign: 1, amount: 2, unit: 'azn' } },
  { id: 'xarici', name: 'Xarici', on: true, needsTable: true, change: { sign: 1, amount: 0.33, unit: 'azn' } },
  { id: 'glovo', name: 'Glovo', on: false, needsTable: false, change: plus10 },
];
const on = { tablesOn: true, deliveryOn: true };
const id = (t: ReturnType<typeof guestOrderType>) => 'error' in t ? t.error : t.id;

describe('the order type of a QR link', () => {
  it('is the one the link names', () => {
    expect(id(guestOrderType(types, 'banket', false, on))).toBe('banket');
    expect(id(guestOrderType(types, 'xarici', true, on))).toBe('xarici');
  });

  it('is Masa at a table and Takeaway without, on the links made before types had QRs', () => {
    expect(id(guestOrderType(types, null, true, on))).toBe('masa');
    expect(id(guestOrderType(types, undefined, false, on))).toBe('takeaway');
  });

  it('takes no orders for a type that is off, gone, or switched off with its module', () => {
    expect(id(guestOrderType(types, 'glovo', false, on))).toBe('bad_type');
    expect(id(guestOrderType(types, 'nope', false, on))).toBe('bad_type');
    expect(id(guestOrderType(types, 'delivery', false, { tablesOn: true, deliveryOn: false }))).toBe('bad_type');
  });

  it('needs a table when the type opens on one, unless Masalar is off', () => {
    expect(id(guestOrderType(types, 'xarici', false, on))).toBe('pick_table');
    expect(id(guestOrderType(types, 'xarici', false, { tablesOn: false, deliveryOn: true }))).toBe('xarici');
  });

  it('has its own link, with the table when it has one', () => {
    expect(guestMenuLink('https://x.az', 'cafe', 'banket')).toBe('https://x.az/cafe/menu?type=banket');
    expect(guestMenuLink('https://x.az', 'cafe', 'xarici', 5)).toBe('https://x.az/cafe/menu?type=xarici&table=5');
  });
});

describe('a QR order under a type', () => {
  const menu: MenuRow[] = [
    { id: 'tea', name: 'Çay', price: 2, available: true, qr_visible: true, variants: null },
    { id: 'fanta', name: 'Fanta', price: 1, available: true, qr_visible: true, variants: [{ id: 'l', name: '1 L', price: 3 }] },
    { id: 'bread', name: 'Çörək', price: 0, available: true, qr_visible: true, variants: null },
  ];

  it('is charged the type price, and keeps the menu price beside it', () => {
    const lines = priceGuestLines([
      { menuItemId: 'tea', quantity: 1 },
      { menuItemId: 'fanta', variantId: 'l', quantity: 2 },
      { menuItemId: 'bread', quantity: 1 },
    ], menu, plus10);
    expect(lines).toEqual([
      expect.objectContaining({ menu_item_id: 'tea', menu_item_price: 2.2, menu_price: 2 }),
      expect.objectContaining({ menu_item_id: 'fanta', menu_item_price: 3.3, menu_price: 3 }),
      expect.objectContaining({ menu_item_id: 'bread', menu_item_price: 0 }),
    ]);
    expect((lines as { menu_price?: number }[])[2]).not.toHaveProperty('menu_price');
  });

  it('costs on the server what the guest saw on the menu', () => {
    for (const change of types.map(t => t.change)) {
      for (const price of [0.33, 1, 2.5, 9.99, 17]) {
        const row: MenuRow = { id: 'x', name: 'x', price, available: true, qr_visible: true, variants: null };
        const [line] = priceGuestLines([{ menuItemId: 'x', quantity: 1 }], [row], change) as { menu_item_price: number }[];
        expect(line.menu_item_price).toBe(typedPrice(price, change));
      }
    }
  });

  it('is priced, saved and charged by its type on the server, never by the guest', () => {
    const route = readFileSync('app/api/guest-order/route.ts', 'utf8');
    expect(route).toContain('priceGuestLines(body.lines ?? [], (menu ?? []) as MenuRow[], orderType.change)');
    expect(route).toContain('...orderTypeColumns(orderTypeFields(orderType))');
    expect(route).not.toMatch(/body\.change/);
  });

  it('shows the menu at the type prices the server will charge', () => {
    const page = readFileSync('app/[slug]/menu/page.tsx', 'utf8');
    expect(page).toContain('typedPrice(Number(p), lt.change)');
    expect(page).toContain('price: typed(r.price)');
    expect(page).toContain('price: typed(v.price)');
    expect(page).toContain('type: typeParam ?? null');
  });

  it('gets its QR from the order types screen, through the one link builder', () => {
    const panel = readFileSync('components/OrderTypesPanel.tsx', 'utf8');
    expect(panel).toContain('<OrderTypeQr');
    const qr = readFileSync('components/OrderTypeQr.tsx', 'utf8');
    expect(qr.match(/guestMenuLink\(/g)?.length).toBe(2);
  });
});

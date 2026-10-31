// 2026-10-08: the QR menu inserted orders with the public anon key, and the
// policy let anon add an order to any restaurant — paid, at any price. Guest
// orders now go through /api/guest-order, priced from the menu.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { priceGuestLines, type MenuRow } from '@/lib/guest-order';

const menu: MenuRow[] = [
  { id: 'tea', name: 'Çay', price: 2, available: true, qr_visible: true, variants: null },
  { id: 'pizza', name: 'Pizza', price: 10, available: true, qr_visible: true,
    variants: [{ id: 'big', name: 'Böyük', price: 15 }] },
  { id: 'gone', name: 'Bitib', price: 5, available: false, qr_visible: true, variants: null },
];

describe('a guest order', () => {
  it('is priced from the menu, not from what the guest sends', () => {
    const lines = priceGuestLines([
      { menuItemId: 'tea', quantity: 2, price: 0.01 } as never,
      { menuItemId: 'pizza', variantId: 'big', quantity: 1 },
    ], menu);
    expect(lines).toEqual([
      expect.objectContaining({ menu_item_id: 'tea', menu_item_price: 2, quantity: 2 }),
      expect.objectContaining({ menu_item_id: 'pizza', menu_item_price: 15, modifiers: 'Böyük' }),
    ]);
  });

  it('is refused for a dish that is off, unknown, or a bad amount', () => {
    expect(priceGuestLines([{ menuItemId: 'gone', quantity: 1 }], menu)).toHaveProperty('error');
    expect(priceGuestLines([{ menuItemId: 'nope', quantity: 1 }], menu)).toHaveProperty('error');
    expect(priceGuestLines([{ menuItemId: 'tea', quantity: 0 }], menu)).toHaveProperty('error');
    expect(priceGuestLines([{ menuItemId: 'tea', quantity: 1.5 }], menu)).toHaveProperty('error');
    expect(priceGuestLines([{ menuItemId: 'pizza', quantity: 1 }], menu)).toHaveProperty('error');
    expect(priceGuestLines([], menu)).toHaveProperty('error');
  });

  // Xidmət haqqı on a QR order at a table, like a Masa order taken at the till
  // (customer request, 2026-10-29). The percent comes from the company row.
  it('pays the Xidmət haqqı of its order type, never one the guest sends', () => {
    const route = readFileSync('app/api/guest-order/route.ts', 'utf8');
    expect(route).toContain('...serviceChargeColumn({ serviceChargePercent: chargeFor(cleanServiceCharge(company.service_charge), orderType.id) })');
    expect(route).not.toMatch(/body\.service/);
  });

  it('shows the guest the same charge the order will get', () => {
    const page = readFileSync('app/[slug]/menu/page.tsx', 'utf8');
    expect(page).toContain("chargeFor(serviceCharge, linkType?.id ?? '')");
    expect(page).toContain('const cartTotal = dishesSum + serviceSum;');
  });

  it('never carries a status or money from the guest', () => {
    const route = readFileSync('app/api/guest-order/route.ts', 'utf8');
    expect(route).toMatch(/status: 'gözləyir'/);
    expect(route).not.toMatch(/body\.(status|cash|card|price)/);
  });

  it('goes through the server, and the database refuses it from anon', () => {
    const page = readFileSync('app/[slug]/menu/page.tsx', 'utf8');
    expect(page).toMatch(/fetch\('\/api\/guest-order'/);
    expect(page).not.toMatch(/addOrder\(/);
    const sql = readFileSync('supabase/migrations/20261008_guest_orders_via_server.sql', 'utf8');
    expect(sql).not.toMatch(/auth\.uid\(\) is null/i);
  });
});

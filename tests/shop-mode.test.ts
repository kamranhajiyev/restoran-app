// Mağaza modu, step 2 (SHOP-MODE.md): the seller page of a shop. Yeni satış
// opens on the products, a sale is paid on the spot, a delivery is still paid
// later, and the lists say "Mağazada", not "Takeaway". A restaurant's till
// stays exactly as it was.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { paysNow, shopDeliveryType, shopSaleType, tabLabel } from '@/lib/shop-mode';
import { DEFAULT_ORDER_TYPES } from '@/lib/order-types';
import { orderPlace } from '@/lib/order-place';

const seller = readFileSync('app/seller/page.tsx', 'utf8');
const route = readFileSync('app/api/public-settings/route.ts', 'utf8');

describe('shop tabs', () => {
  it('are Yeni satış and Satışlar in a shop, unchanged in a restaurant', () => {
    expect(tabLabel('new-order', 'shop')).toBe('Yeni satış');
    expect(tabLabel('orders', 'shop')).toBe('Satışlar');
    expect(tabLabel('kassa', 'shop')).toBe('Kassa');
    expect(tabLabel('new-order', 'restaurant')).toBe('Yeni sifariş');
    expect(tabLabel('orders', 'restaurant')).toBe('Sifarişlər');
    expect(seller).toMatch(/label: tabLabel\(id, kind\)/);
  });
});

describe('a shop sale', () => {
  it('is saved as Takeaway, even if a former restaurant had switched Takeaway off', () => {
    expect(shopSaleType(DEFAULT_ORDER_TYPES).builtIn).toBe('takeaway');
    const off = DEFAULT_ORDER_TYPES.map(t => t.builtIn === 'takeaway' ? { ...t, on: false } : t);
    expect(shopSaleType(off)).toMatchObject({ builtIn: 'takeaway', on: true });
    expect(shopSaleType([]).builtIn).toBe('takeaway');
  });

  it('offers Çatdırılma only when the shop delivers', () => {
    expect(shopDeliveryType(DEFAULT_ORDER_TYPES, true)?.builtIn).toBe('delivery');
    expect(shopDeliveryType(DEFAULT_ORDER_TYPES, false)).toBeNull();
  });

  it('is paid on the spot — not a delivery, not an addition, never in a restaurant', () => {
    expect(paysNow({ kind: 'shop', appending: false, delivery: false })).toBe(true);
    expect(paysNow({ kind: 'shop', appending: false, delivery: true })).toBe(false);
    expect(paysNow({ kind: 'shop', appending: true, delivery: false })).toBe(false);
    expect(paysNow({ kind: 'restaurant', appending: false, delivery: false })).toBe(false);
  });

  it('opens payment straight after saving, and goes back to an empty Yeni satış', () => {
    expect(seller).toMatch(/const shopSale = paysNow\(\{ kind, appending: !!appendOrderId, delivery: orderType === 'kuryer' \}\)/);
    expect(seller).toMatch(/if \(payNow\) \{ setView\('new-order'\); openPayment\(order\); return; \}/);
    expect(seller).toMatch(/if \(isShop && view === 'new-order' && !appendOrderId\) void pickSaleType\(shopType\)/);
    expect(seller.match(/shopSale \? `Ödə · \$\{cartToPayNow\.toFixed\(2\)\} ₼` : submit\.label/g)).toHaveLength(2);
    expect(seller.match(/\{!shopSale && <PrintKitchenToggle/g)).toHaveLength(2);
  });
});

describe('the place word', () => {
  const cfg = { tables: [], tablesOn: true, deliveryOn: true, halls: [] };
  const counter = { tableNumber: 0 };
  it('is Mağazada in a shop that delivers, nothing in one that does not', () => {
    expect(orderPlace(counter, { ...cfg, shop: true })).toBe('Mağazada');
    expect(orderPlace(counter, { ...cfg, deliveryOn: false, shop: true })).toBe('');
    expect(orderPlace({ tableNumber: 0, courierId: 'c1' }, { ...cfg, shop: true })).toBe('Çatdırılma');
  });
  it('stays Takeaway in a restaurant', () => {
    expect(orderPlace(counter, cfg)).toBe('Takeaway');
    expect(seller).toMatch(/placeOf\(order, \{ tables, tablesOn: tablesOn && !isShop, deliveryOn, halls, shop: isShop \}\)/);
  });
});

describe('the kind reaches every till', () => {
  it('a link till and the exe/APK get it from public-settings, read apart so an old database still answers', () => {
    expect(route).toMatch(/select\('kind'\)/);
    expect(route).toMatch(/kind: cleanKind\(kindRead\.data\?\.kind\)/);
    expect(route).not.toMatch(/select\('tables_enabled[^']*kind/);
  });
  it('a signed-in till reads its own row, and a failed read keeps what it has', () => {
    expect(seller).toMatch(/if \(s\.kind\) setKind\(s\.kind\)/);
  });
});

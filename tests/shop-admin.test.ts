// Mağaza modu, step 4 (SHOP-MODE.md): the admin panel of a shop. Satışlar,
// Məhsullar and Onlayn in place of Sifarişlər, Menyu and Masalar; how a sale
// was paid in place of its status; no stations, modifiers, dishes, waiters,
// kitchen staff, ingredients, order types or service charge; Brendinq in
// Tənzimləmələr. A restaurant's admin is unchanged.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { paidHow, SHOP_ADMIN, SHOP_HIDDEN_ACTIONS } from '@/lib/shop-mode';
import { placeSales } from '@/lib/place-sales';
import type { Order } from '@/types';

const admin = readFileSync('app/admin/page.tsx', 'utf8');
const anbar = readFileSync('components/AnbarPanel.tsx', 'utf8');
const rules = readFileSync('components/TillRulesPanel.tsx', 'utf8');

describe('a shop\'s admin', () => {
  it('names its tabs Satışlar, Məhsullar and Onlayn', () => {
    expect(SHOP_ADMIN.orders?.label).toBe('Satışlar');
    expect(SHOP_ADMIN.menu?.label).toBe('Məhsullar');
    expect(SHOP_ADMIN.tables?.label).toBe('Onlayn');
    expect(admin).toMatch(/const n = isShop \? \{ \.\.\.raw, label: SHOP_ADMIN\[raw\.id\]\?\.label \?\? raw\.label, icon: raw\.id === 'tables' \? Globe : raw\.icon \} : raw;/);
  });

  it('shows how each sale was paid', () => {
    const base = { status: 'ödənilib' };
    expect(paidHow({ ...base, cashAmount: 5 })).toBe('Nağd');
    expect(paidHow({ ...base, cardAmount: 5 })).toBe('Kart');
    expect(paidHow({ ...base, cashAmount: 2, cardAmount: 3 })).toBe('Nağd + Kart');
    expect(paidHow({ ...base, courierDebt: 7 })).toBe('Kuryerdə');
    expect(paidHow({ status: 'gözləyir' })).toBeNull();
    expect(admin).toMatch(/isShop\s*\? <><span>Vaxt<\/span><span>Satış<\/span><span>Ödəniş<\/span>/);
  });

  it('calls a counter sale Mağazada in Satış tipləri, and hides it without delivery', () => {
    const o = (over: Partial<Order>) => ({ id: 'x', tableNumber: 0, items: [], status: 'ödənilib', createdAt: '', ...over }) as Order;
    const rows = placeSales([o({}), o({ courierId: 'c' })], true, () => 1, true);
    expect(rows.map(r => r.label)).toEqual(['Mağazada', 'Çatdırılma']);
    expect(placeSales([o({})], true, () => 1).map(r => r.label)).toEqual(['Takeaway']);
    expect(admin).toMatch(/\$\{isShop && !deliveryOn \? 'hidden' : ''\}`\}>\s*<h3[^>]*>Satış tipləri/);
  });

  it('keeps products only: no stations, modifiers or Yemək; a new one is a Məhsul', () => {
    expect(admin).toMatch(/\$\{isShop \? 'hidden' : ''\}`\}>\s*\{\(\[\['items', 'Məhsullar'\], \['stations', 'Sexlər'\]/);
    expect(admin).toMatch(/\{!isShop && stations\.length > 0 && form\.kind !== 'set' && \(/);
    expect(admin).toMatch(/filter\(\(\[val\]\) => !\(isShop && val === 'meal'\)\)/);
    expect(admin).toMatch(/kind: kindFilter === 'all' \? \(isShop \? 'product' : 'meal'\) : kindFilter/);
  });

  it('has no tables on the Onlayn tab, and its QR switches show without them', () => {
    expect(admin).toMatch(/\{!isShop && \(<>\n\s*\{\/\* ── Masalar ── \*\/\}/);
    expect(admin.match(/\{\(tablesOn \|\| isShop\) && \(/g)).toHaveLength(2);
  });

  it('keeps Brendinq and Girişlər in Tənzimləmələr', () => {
    expect(admin).toMatch(/isShop \? \['brendinq', 'girişlər'\] as const : \['növlər', 'xidmət', 'girişlər'\] as const/);
    expect(admin).toMatch(/\{tab === 'settings' && settingsSub === 'brendinq' && \(\s*<div className="max-w-3xl space-y-4">\{brandingBlock\}<\/div>/);
    expect(admin).toMatch(/\{!isShop && brandingBlock\}/);
  });

  it('has no waiters, kitchen staff or after-the-bill rules', () => {
    expect(SHOP_HIDDEN_ACTIONS).toEqual(['remove_after_bill', 'add_after_bill']);
    expect(admin).toMatch(/filter\(r => !\(isShop && r === 'waiter' && sRole !== 'waiter'\)\)/);
    expect(admin).toMatch(/\{isShop \? null : stations\.length === 0 \? \(/);
    expect(admin).toMatch(/<TillRulesPanel staff=\{pinStaff\} shop=\{isShop\} \/>/);
    expect(rules).toMatch(/TILL_ACTIONS\.filter\(a => shop \? !SHOP_HIDDEN_ACTIONS\.includes\(a\.id\) : !SHOP_ONLY_ACTIONS\.includes\(a\.id\)\)/);
  });

  it('has no ingredients in Anbar', () => {
    expect(admin).toMatch(/<AnbarPanel setDialog=\{setDialog\} shop=\{isShop\} \/>/);
    expect(anbar).toMatch(/const typeFilter = shop \? 'product' : typeFilterPicked;/);
  });
});

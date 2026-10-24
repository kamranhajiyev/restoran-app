// The seller's order card listed every round apart — Fanta three times, the
// preview "Çoban salatı, Çoban salatı, Çoban salatı, Çoban salatı" — and the
// seller added them up by hand (Test Restoran, 2026-10-20). The seller now sees
// one line per dish; the rounds with times stay in admin and one tap away.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import OrderItemsMerged from '@/components/OrderItemsMerged';
import { OrderRow } from '@/components/seller/OrderRow';
import type { MenuItem, Order, OrderItem } from '@/types';

const salad: MenuItem = { id: 's', name: 'Çoban salatı', price: 3.75, category: 'Yemək', available: true };
const rounds: OrderItem[] = [
  { id: 'a', menuItem: salad, quantity: 1, createdAt: '2026-10-20T10:00:00Z' },
  { id: 'b', menuItem: salad, quantity: 2, createdAt: '2026-10-20T10:20:00Z' },
  { id: 'c', menuItem: salad, quantity: 1, createdAt: '2026-10-20T10:40:00Z' },
];
const order = {
  id: 'o1', tableNumber: 1, status: 'gözləyir', createdAt: '2026-10-20T10:00:00Z', items: rounds,
} as unknown as Order;

describe('the seller\'s order card', () => {
  it('shows one line per dish with the whole count', () => {
    const html = renderToStaticMarkup(createElement(OrderItemsMerged, { order }));
    expect(html.match(/Çoban salatı/g)).toHaveLength(1);
    expect(html).toContain('4 əd');
    expect(html).toContain('15.00 ₼');
  });

  it('is green only when every round is ready, and says how many otherwise', () => {
    const some = renderToStaticMarkup(createElement(OrderItemsMerged, { order, isItemReady: oi => oi.id !== 'c' }));
    expect(some).toContain('3/4 hazır');
    expect(some).not.toContain('✓');
    const all = renderToStaticMarkup(createElement(OrderItemsMerged, { order, isItemReady: () => true }));
    expect(all).toContain('✓');
  });

  it('previews "Çoban salatı ×4" on the closed row', () => {
    const html = renderToStaticMarkup(createElement(OrderRow, {
      order, tableLabel: 'Masa 1', tz: 'Asia/Baku', printFailed: false, unsent: false,
      progress: { done: 0, total: 3 }, isItemReady: () => false,
      onReprint: () => {}, onPay: () => {}, onCancel: () => {}, canPickCourier: false,
      onAppend: () => {}, onMove: () => {}, onReassign: () => {}, onPrintBill: () => {}, billBusy: false,
      onStatusChange: () => {},
    }));
    expect(html).toContain('Çoban salatı ×4');
  });

  it('leaves the admin page showing every round with its time', () => {
    const admin = readFileSync(join(__dirname, '..', 'app/admin/page.tsx'), 'utf8');
    expect(admin).toContain('<OrderItemHistory');
    expect(admin).not.toContain('OrderItemsMerged');
  });
});

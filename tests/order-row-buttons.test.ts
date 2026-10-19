// Sellers had to open an order to reach "Düzəliş" and "Çap et", the two
// things done most to an open table (Test Restoran, 2026-10-19). They now sit
// on the row, and "Ödənişsiz bağla" stays last, apart from "Düzəliş", so a
// rushed click can't close the order without payment.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OrderRow } from '@/components/seller/OrderRow';
import type { Order } from '@/types';

const noop = () => {};

function desktopRow(order: Order) {
  const html = renderToStaticMarkup(createElement(OrderRow, {
    order, tableLabel: 'Masa 2', tz: 'Asia/Baku', printFailed: false, unsent: false,
    progress: { done: 0, total: 1 }, isItemReady: () => false,
    onReprint: noop, onPay: noop, onCancel: noop, onReturn: noop, canPickCourier: false,
    onAppend: noop, onMove: noop, onReassign: noop, onPrintBill: noop, billBusy: false,
    onStatusChange: noop,
  }));
  // The desktop row is the second block; the mobile card comes first.
  return html.slice(html.indexOf('hidden md:block'));
}

const open = {
  id: 'o1', tableNumber: 2, status: 'gözləyir', createdAt: new Date().toISOString(),
  items: [{ menuItem: { id: 'm1', name: 'Limonad', price: 2 }, quantity: 1 }],
} as unknown as Order;

describe('the order row', () => {
  it('shows print, edit, pay and then free close, without opening the order', () => {
    const row = desktopRow(open);
    const at = (s: string) => row.indexOf(s);
    expect(at('aria-label="Çap et"')).toBeGreaterThan(-1);
    expect(at('Düzəliş<')).toBeGreaterThan(at('aria-label="Çap et"'));
    expect(at('Ödəniş<')).toBeGreaterThan(at('Düzəliş<'));
    expect(at('Ödənişsiz bağla')).toBeGreaterThan(at('Ödəniş<'));
  });

  it('keeps free close apart from the other buttons', () => {
    const row = desktopRow(open);
    const cancel = row.slice(row.lastIndexOf('<button', row.indexOf('Ödənişsiz bağla')));
    expect(cancel).toMatch(/class="ml-\d/);
  });

  it('offers none of them on a paid order', () => {
    const row = desktopRow({ ...open, status: 'ödənilib' } as Order);
    expect(row).not.toContain('Düzəliş<');
    expect(row).not.toContain('aria-label="Çap et"');
  });
});

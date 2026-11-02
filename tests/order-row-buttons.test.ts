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
    onReprint: noop, onPay: noop, onCancel: noop, canPickCourier: false,
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
  it('shows print, edit, pay and the "⋯" menu, without opening the order', () => {
    const row = desktopRow(open);
    const at = (s: string) => row.indexOf(s);
    expect(at('aria-label="Çap et"')).toBeGreaterThan(-1);
    expect(at('Düzəliş<')).toBeGreaterThan(at('aria-label="Çap et"'));
    expect(at('Ödəniş<')).toBeGreaterThan(at('Düzəliş<'));
    expect(at('aria-label="Digər"')).toBeGreaterThan(at('Ödəniş<'));
  });

  // 2026-11-02: free close moved from the row into the "⋯" menu, so no rushed
  // tap on the row can close an order unpaid.
  it('keeps free close off the row itself', () => {
    expect(desktopRow(open)).not.toContain('Ödənişsiz bağla');
  });

  it('gives every row button a finger-sized 44px target', () => {
    const row = desktopRow(open);
    for (const label of ['aria-label="Çap et"', 'Düzəliş<', 'Ödəniş<', 'aria-label="Digər"']) {
      const start = row.lastIndexOf('<button', row.indexOf(label));
      const button = row.slice(start, row.indexOf('>', start));
      expect(button, label).toMatch(/\bh-11\b/);
    }
  });

  it('offers none of them on a paid order', () => {
    const row = desktopRow({ ...open, status: 'ödənilib' } as Order);
    expect(row).not.toContain('Düzəliş<');
    expect(row).not.toContain('aria-label="Çap et"');
  });
});

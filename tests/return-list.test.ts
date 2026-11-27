// 2026-11-27: the owner could see how much came back (Statistika, shift) but
// not which returns: no receipt, time, seller or products anywhere in admin.
// Satışlar now has Qaytarmalar for a shop, built on these.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { filterReturnList, returnReceipt, type SaleReturn } from '@/lib/returns';

const ret = (id: string, o: Partial<SaleReturn>): SaleReturn => ({
  id, orderId: null, total: 5, pay: 'cash', sellerName: 'Aysel', approvedBy: null,
  createdAt: '2026-11-27T10:00:00.000Z', lines: [{ menuItemId: 'm', variantId: null, name: 'Çay', qty: 1, price: 5 }], ...o,
});
const labels = { s45: '45/2', s7: '7' };
const list = [
  ret('a', { orderId: 's45', sellerName: 'Aysel', lines: [{ menuItemId: 'x', variantId: null, name: 'Süd 1L', qty: 2, price: 2 }] }),
  ret('b', { orderId: 's7', sellerName: 'Kərim', pay: 'card', approvedBy: 'Natiq' }),
  ret('c', { orderId: null, sellerName: 'Aysel' }),
];

describe('Qaytarmalar list', () => {
  it('names the receipt a return came from', () => {
    expect(returnReceipt(list[0], labels)).toBe('Qəbz №45/2');
    expect(returnReceipt(list[2], labels)).toBe('Qəbzsiz');
    expect(returnReceipt(ret('d', { orderId: 'gone' }), labels)).toBe('Qəbz tapılmadı');
  });

  it('finds a return by receipt number, seller, approver or product', () => {
    const ids = (q: string) => filterReturnList(list, labels, { query: q }).map(r => r.id);
    expect(ids('45')).toEqual(['a']);
    expect(ids('45/2')).toEqual(['a']);
    expect(ids('kərim')).toEqual(['b']);
    expect(ids('natiq')).toEqual(['b']);
    expect(ids('süd')).toEqual(['a']);
    expect(ids('')).toEqual(['a', 'b', 'c']);
  });

  it('narrows to cash or card', () => {
    expect(filterReturnList(list, labels, { pay: 'card' }).map(r => r.id)).toEqual(['b']);
    expect(filterReturnList(list, labels, { pay: 'cash' }).map(r => r.id)).toEqual(['a', 'c']);
  });

  it('admin Satışlar shows the returns through lib/returns, not its own copy', () => {
    const page = readFileSync('app/admin/page.tsx', 'utf8');
    expect(page).toContain('filterReturnList(');
    expect(page).toContain('returnReceipt(');
    expect(page).toContain('fetchSaleLabelsOrNull(');
    expect(page).toContain('Qaytarmalar');
  });
});

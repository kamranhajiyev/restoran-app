// Mağaza modu, step 7 (SHOP-MODE.md): a shop's receipt says Qəbz, Mağazada
// and Kassir, and ends in its number as a Code 128 barcode — only when the
// number is the server's, so a return can never be pointed at another sale.
// A restaurant's receipt is unchanged.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { code128Modules, code128Values } from '@/lib/code128';
import { receiptLines } from '@/lib/printer';
import type { Order } from '@/types';

const order = {
  id: 'o1', orderNumber: 100125, tableNumber: 0, status: 'ödənilib', createdAt: '2026-11-14T10:00:00Z',
  sellerName: 'Kamran', cashAmount: 2, cardAmount: 0,
  items: [{ menuItem: { id: 'c', name: 'Cappy', price: 2, category: 'İçki', available: true }, quantity: 1 }],
} as unknown as Order;

const texts = (o: Order, shop: boolean, barcode = false) => receiptLines(o, 'Test Mağaza', undefined, shop, barcode);

describe('Code 128', () => {
  it('wraps the data in START B, a checksum and STOP', () => {
    // "12": values 17, 18; checksum (104 + 17·1 + 18·2) mod 103 = 54.
    expect(code128Values('12')).toEqual([104, 17, 18, 54, 106]);
    expect(code128Values('Ə')).toBeNull();
  });
  it('is 11 modules a symbol and 13 for STOP, bars and spaces alternating', () => {
    const m = code128Modules('2-100125')!;
    expect(m.reduce((a, b) => a + b, 0)).toBe(11 * (8 + 3) + 2);
    expect(m.length % 2).toBe(1); // starts and ends with a bar
  });
});

describe('a shop\'s receipt', () => {
  it('says Qəbz, Mağazada and Kassir', () => {
    const t = texts(order, true).map(l => l.text);
    expect(t).toContain('Qəbz #100125');
    expect(t).toContain('Mağazada');
    expect(t).toContain('Kassir: Kamran');
  });
  it('ends in the number as a barcode only when the number is the server\'s', () => {
    expect(texts(order, true, true).at(-1)).toEqual({ text: '100125', barcode: '100125' });
    expect(texts(order, true, false).some(l => l.barcode)).toBe(false);
    expect(texts({ ...order, orderNumber: 0 } as Order, true, true).some(l => l.barcode)).toBe(false);
  });
  it('a restaurant\'s receipt is as it was', () => {
    const t = texts(order, false).map(l => l.text);
    expect(t).toContain('Sifariş #100125');
    expect(t).toContain('Ofisiant: Kamran');
    expect(texts(order, false, true).some(l => l.barcode)).toBe(false);
  });
  it('the till prints it with the real number, read back before printing', () => {
    const seller = readFileSync('app/seller/page.tsx', 'utf8');
    expect(seller).toMatch(/const n = await realOrderNumber\(order\);/);
    expect(seller).toMatch(/if \(isShop\) void printShopReceipt\(paidOrder, cName\);/);
    expect(seller).toMatch(/return fetchOrderNumber\(order\.id\);/);
  });
});

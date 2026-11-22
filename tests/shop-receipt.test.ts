// Mağaza modu, step 7 (SHOP-MODE.md): a shop's receipt says Qəbz, Mağazada
// and Kassir, and ends in its number as a Code 128 barcode — only when the
// number is the server's, so a return can never be pointed at another sale.
// A restaurant's receipt is unchanged.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { code128Modules, code128Values } from '@/lib/code128';
import { receiptLines, returnReceiptLines, qtyText } from '@/lib/printer';
import { WIDTH } from '@/lib/escpos';
import type { Order } from '@/types';

const order = {
  id: 'o1', orderNumber: 100125, tableNumber: 0, status: 'ödənilib', createdAt: '2026-11-14T10:00:00Z',
  sellerName: 'Kamran', cashAmount: 2, cardAmount: 0,
  items: [{ menuItem: { id: 'c', name: 'Cappy', price: 2, category: 'İçki', available: true }, quantity: 1 }],
} as unknown as Order;

const texts = (o: Order, shop: boolean, barcode = false, delivery = true) =>
  receiptLines(o, 'Test Mağaza', undefined, shop ? { delivery } : undefined, barcode);

const item = (name: string, price: number, quantity: number) =>
  ({ menuItem: { id: name, name, price, category: 'Ərzaq', available: true }, quantity });
const eggs = {
  ...order, cashAmount: 2.85,
  items: [item('Yumurta AG ED', 0.17, 10), item('Çörək N1 400qr Borodin', 1.15, 1)],
} as unknown as Order;
const squash = (s: string) => s.trim().replace(/\s+/g, ' ');

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
  it('says Mağazada only when the shop also delivers, like the screen', () => {
    expect(texts(order, true, false, true).map(l => l.text)).toContain('Mağazada');
    expect(texts(order, true, false, false).map(l => l.text)).not.toContain('Mağazada');
    // A delivery is still named, and a restaurant's takeaway is as it was.
    expect(texts({ ...order, courierId: 'k1' } as Order, true, false, false).map(l => l.text)).toContain('Çatdırılma');
    expect(texts(order, false).map(l => l.text)).toContain('Takeaway');
  });
  it('the till and admin tell the paper whether the shop delivers', () => {
    expect(readFileSync('app/seller/page.tsx', 'utf8')).toMatch(/\{ delivery: deliveryOn \}, !!n\)/);
    expect(readFileSync('app/admin/page.tsx', 'utf8')).toMatch(/isShop \? \{ delivery: deliveryOn \} : undefined, isShop\)/);
  });
  it('prints Miqdar, Qiymət and Toplam in columns, the price of one included', () => {
    const t = texts(eggs, true).map(l => l.text);
    expect(squash(t.find(l => l.startsWith('Malın adı'))!)).toBe('Malın adı Miqdar Qiymət Toplam');
    // A short name shares its row; one too long for the name column gets its own.
    expect(t.map(squash)).toContain('Yumurta AG ED 10 əd 0.17 1.70');
    expect(t).toContain('Çörək N1 400qr Borodin');
    expect(t.map(squash)).toContain('1 əd 1.15 1.15');
    // Each column ends where its header ends, whatever the name's length.
    const head = t.find(l => l.startsWith('Malın adı'))!;
    for (const l of t.filter(l => / əd /.test(l))) {
      expect(l.length).toBe(WIDTH);
      expect(l.indexOf('əd') + 2).toBe(head.indexOf('Miqdar') + 'Miqdar'.length);
    }
  });
  it('wraps a long name instead of cutting it or the columns', () => {
    const long = { ...eggs, items: [item('Şokolad Alpen Gold fındıqlı və kişmişli böyük paket 200 qr', 3.4, 2)] } as unknown as Order;
    const t = texts(long, true).map(l => l.text);
    expect(t.join(' ')).toMatch(/Şokolad Alpen Gold .*200 qr/);
    expect(t.every(l => l.length <= WIDTH)).toBe(true);
    expect(t.map(squash)).toContain('paket 200 qr 2 əd 3.40 6.80');
  });
  it('parts the items with a hairline, not after the last', () => {
    const lines = texts(eggs, true);
    expect(lines.filter(l => l.rule)).toHaveLength(1);
    const at = lines.findIndex(l => l.rule);
    expect(squash(lines[at - 1].text)).toBe('Yumurta AG ED 10 əd 0.17 1.70');
    expect(lines[at + 1].text).toBe('Çörək N1 400qr Borodin');
  });
  it('writes money one way on a shop\'s paper; a restaurant\'s keeps its m', () => {
    expect(texts(eggs, true).map(l => squash(l.text))).toEqual(expect.arrayContaining(['YEKUN: 2.85', 'Nağd: 2.85']));
    expect(texts(eggs, true).some(l => /\dm$/.test(l.text))).toBe(false);
    expect(texts(eggs, false).map(l => squash(l.text))).toContain('YEKUN: 2.85m');
  });
  it('drops the zeros from a count', () => {
    expect(qtyText(10)).toBe('10 əd');
    expect(qtyText(0.45)).toBe('0.45 əd');
    expect(qtyText(1.2000001)).toBe('1.2 əd');
  });
  it('the Qaytarma paper uses the same columns', () => {
    const t = returnReceiptLines({ total: 0.34, pay: 'cash', sellerName: 'Kamran', approvedBy: null, createdAt: '2026-11-14T10:00:00Z',
      lines: [{ menuItemId: 'y', name: 'Yumurta AG ED', qty: 2, price: 0.17 }] } as never, 'Test Mağaza', '45').map(l => squash(l.text));
    expect(t).toContain('Malın adı Miqdar Qiymət Toplam');
    expect(t).toContain('Yumurta AG ED 2 əd 0.17 0.34');
  });
  it('ends in the number as a barcode only when the number is the server\'s', () => {
    expect(texts(order, true, true).at(-1)).toMatchObject({ text: '100125', barcode: '100125' });
    expect(texts(order, true, false).some(l => l.barcode)).toBe(false);
    expect(texts({ ...order, orderNumber: 0 } as Order, true, true).some(l => l.barcode)).toBe(false);
  });
  it('a restaurant\'s receipt is as it was', () => {
    const t = texts(order, false).map(l => l.text);
    expect(t).toContain('Sifariş #100125');
    expect(t).toContain('Ofisiant: Kamran');
    expect(t.some(l => l.startsWith('Malın adı'))).toBe(false);
    expect(texts(order, false, true).some(l => l.barcode)).toBe(false);
  });
  it('a restaurant\'s receipt and bill show the price of one too (2026-11-17)', async () => {
    const { billLines } = await import('@/lib/printer');
    for (const paper of [texts(eggs, false), billLines(eggs, 'Test Restoran')]) {
      const t = paper.map(l => squash(l.text));
      expect(t).toContain('Məhsul Miqdar Qiymət Toplam');
      expect(t).toContain('Yumurta AG ED 10 əd 0.17 1.70');
    }
  });
  it('the till prints it with the real number, read back before printing', () => {
    const seller = readFileSync('app/seller/page.tsx', 'utf8');
    expect(seller).toMatch(/const n = await realOrderNumber\(order\);/);
    expect(seller).toMatch(/if \(isShop\) void printShopReceipt\(paidOrder, cName\);/);
    expect(seller).toMatch(/return fetchOrderNumber\(order\.id\);/);
  });
});

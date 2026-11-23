// The new paper (2026-11-20): receipts, bills and kitchen tickets drawn in
// Montserrat with rows, a boxed total and big dishes, a dark logo flipped to
// print, and the cash the guest gave instead of what the till kept.

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { Order } from '@/types';
import type { Line } from '@/lib/raster';
import { cleanLogo, wrapToWidth } from '@/lib/paper';
import { cashGiven } from '@/lib/cash-given';
import { billLines, receiptLines, returnReceiptLines } from '@/lib/printer';

const drawn: Line[][] = [];
vi.mock('@/lib/raster', async (orig) => ({
  ...(await orig<typeof import('@/lib/raster')>()),
  rasterize: (lines: Line[]) => { drawn.push(lines); return new Uint8Array(); },
}));

const item = (name: string, price: number, quantity: number, modifiers?: string) =>
  ({ menuItem: { id: name, name, price, category: 'x', available: true }, quantity, modifiers });
const paid = {
  id: 'o1', orderNumber: 145, tableNumber: 6, status: 'ödənilib', createdAt: '2026-11-20T15:12:00Z', sellerName: 'Aytac',
  cashAmount: 40.39, cardAmount: 50, changeAmount: 9.61,
  items: [item('Toyuq kababı', 9.5, 2), item('Şah plov', 18, 1, 'az duzlu'), item('Limonad', 3.5, 3), item('Çay', 6, 1), item('Paxlava', 27.39, 1)],
} as unknown as Order;

describe('cash given', () => {
  it('is the cash kept plus the change', () => {
    expect(cashGiven({ cashAmount: 40.39, changeAmount: 9.61 })).toBe(50);
    expect(cashGiven({ cashAmount: 12 })).toBe(12);
    expect(cashGiven({})).toBe(0);
  });
  it('the receipt prints what the guest handed over', () => {
    const t = receiptLines(paid, 'Şəhrizad', 'Zal 1 / Masa 6').map(l => l.text.replace(/\s+/g, ' '));
    expect(t).toContain('Nağd: 50.00m');
    expect(t).toContain('Qaytarıldı: 9.61m');
  });
  it('the till and the admin show the same number', () => {
    for (const f of ['app/seller/page.tsx', 'app/admin/page.tsx']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).toContain('cashGiven(order).toFixed(2)} alındı');
      expect(src, f).not.toMatch(/\(order\.cashAmount \?\? 0\) \+ order\.changeAmount/);
    }
  });
});

describe('the receipt and the bill', () => {
  it('every line says how the new paper draws it', () => {
    for (const lines of [receiptLines(paid, 'Şəhrizad', 'Zal 1 / Masa 6'), billLines(paid, 'Şəhrizad', 'Zal 1 / Masa 6')]) {
      expect(lines.filter(l => !l.style).map(l => l.text)).toEqual([]);
    }
  });
  it('the amount paid is a boxed YEKUN, the bill\'s a boxed ÖDƏNİLƏCƏK', () => {
    expect(receiptLines(paid, 'Ş').find(l => l.style?.k === 'total')!.style).toEqual({ k: 'total', left: 'YEKUN', right: '90.39 ₼' });
    expect(billLines(paid, 'Ş').find(l => l.style?.k === 'total')!.style).toMatchObject({ left: 'ÖDƏNİLƏCƏK' });
  });
  it('a dish\'s options are drawn apart from its name', () => {
    const row = receiptLines(paid, 'Ş').find(l => l.style?.k === 'cols' && l.style.cells[0] === 'Şah plov')!;
    expect(row.style).toMatchObject({ note: 'az duzlu', cells: ['Şah plov', '1', '18.00', '18.00'] });
  });
  it('number and place share a row, so the place is not drawn twice', () => {
    const lines = receiptLines(paid, 'Ş', 'Zal 1 / Masa 6');
    expect(lines.find(l => l.text === 'Sifariş #145')!.style).toMatchObject({ k: 'kv', right: 'Zal 1 / Masa 6' });
    expect(lines.find(l => l.text === 'Zal 1 / Masa 6')!.style).toEqual({ k: 'skip' });
  });
});

describe('the kitchen ticket', () => {
  it('draws the heading on a bar, dishes big with their notes, the guest\'s note boxed', async () => {
    const { buildStationTicketRaster } = await import('@/lib/station-ticket');
    drawn.length = 0;
    await buildStationTicketRaster({
      kind: 'new', station: 'Mətbəx', orderNumber: 145, table: 6, waiter: 'Aytac', at: '2026-11-20T13:58:00Z',
      note: 'Uşaq üçün, acı olmasın',
      items: [{ name: 'Dana bifşteks, göbələk sousu ilə, qril tərəvəz', qty: 1, modifiers: 'duzsuz və acısız' }, { name: 'Qutab', qty: 12 }],
    }, () => 'Zal 1 / Masa 6');
    const styles = drawn[0].map(l => l.style);
    expect(styles).toContainEqual({ k: 'bar', text: 'YENİ SİFARİŞ' });
    expect(styles).toContainEqual({ k: 'item', qty: '1x', name: 'Dana bifşteks, göbələk sousu ilə, qril tərəvəz' });
    expect(styles).toContainEqual({ k: 'mod', lead: '→ ', text: 'duzsuz və acısız' });
    expect(styles).toContainEqual({ k: 'center', size: 44, weight: 800 }); // the table, biggest
    expect(styles.filter(s => s?.k === 'text' && s.box && !s.cont)).toHaveLength(1);
    // A long name's wrapped rows are drawn once, by its first row.
    expect(drawn[0].filter(l => l.style?.k === 'item')).toHaveLength(2);
    expect(drawn[0].every(l => l.style)).toBe(true);
  });

  it('a long note is drawn whole, not just its first row', async () => {
    const { buildStationTicketRaster } = await import('@/lib/station-ticket');
    const note = 'Uşaq üçün olan yeməklər əvvəl gəlsin. Masada qlütenə allergiyası olan qonaq var, çörək verməyin!';
    for (const kind of ['new', 'note'] as const) {
      drawn.length = 0;
      await buildStationTicketRaster({ kind, station: 'Mətbəx', orderNumber: 1, table: null, waiter: null, at: '2026-11-20T13:58:00Z', note, items: [] });
      const shown = drawn[0].map(l => l.style).filter(s => s?.k === 'text' && !s.cont).map(s => s?.k === 'text' ? s.whole : '');
      expect(shown.join(' '), kind).toContain('çörək verməyin!');
    }
  });
});

describe('a logo', () => {
  // w×h RGBA, filled with `bg`, with `fg` in the box [x0,x1)×[y0,y1).
  function img(w: number, h: number, bg: number[], fg: number[], box: [number, number, number, number]) {
    const px = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = x >= box[0] && x < box[1] && y >= box[2] && y < box[3] ? fg : bg;
      px.set(c, (y * w + x) * 4);
    }
    return px;
  }
  it('on a dark ground prints its light letters, not a black block (Şəhrizad)', () => {
    const navy = [15, 42, 63, 255], white = [255, 255, 255, 255];
    const c = cleanLogo(img(20, 10, navy, white, [5, 15, 3, 7]), 20, 10)!;
    expect(c).toMatchObject({ x: 5, y: 3, w: 10, h: 4 });
    expect(c.ink[0]).toBe(0);          // the navy corner is paper
    expect(c.ink[3 * 20 + 5]).toBe(1); // the letters are ink
  });
  it('on white prints its dark parts, cut to them', () => {
    const c = cleanLogo(img(20, 10, [255, 255, 255, 255], [0, 0, 0, 255], [2, 4, 1, 9]), 20, 10)!;
    expect(c).toMatchObject({ x: 2, y: 1, w: 2, h: 8 });
  });
  it('a transparent ground is paper', () => {
    const c = cleanLogo(img(10, 10, [0, 0, 0, 0], [0, 0, 0, 255], [4, 6, 4, 6]), 10, 10)!;
    expect(c).toMatchObject({ x: 4, y: 4, w: 2, h: 2 });
  });
  it('nothing to print is no logo', () => {
    expect(cleanLogo(img(4, 4, [255, 255, 255, 255], [255, 255, 255, 255], [0, 0, 0, 0]), 4, 4)).toBeNull();
  });
});

describe('wrapping by width', () => {
  const measure = (s: string) => s.length * 10;
  it('breaks between words to fit', () => {
    expect(wrapToWidth('Toyuq kababı fileli', 130, measure)).toEqual(['Toyuq kababı', 'fileli']);
  });
  it('splits a word wider than the row', () => {
    expect(wrapToWidth('abcdefghij', 40, measure)).toEqual(['abcd', 'efgh', 'ij']);
  });
});

// The new drawing skips a line without a style, so a paper that mixes the two
// prints only half. The Qaytarma slip took the item columns with their styles
// and lost its name, heading and minus total (2026-11-22, before any till had it).
describe('every line of a paper is drawn', () => {
  const unstyled = (lines: Line[]) => lines.some(l => l.style) ? lines.filter(l => !l.style).map(l => l.text) : [];
  const back = { total: 2, pay: 'cash' as const, sellerName: 'Kamran', approvedBy: 'Menecer', createdAt: '2026-11-14T10:00:00Z',
    lines: [{ menuItemId: 'cappy', variantId: null, name: 'Cappy', qty: 1, price: 2 }] };
  it('receipt, bill, shop receipt and return slip', () => {
    expect(unstyled(receiptLines(paid, 'Şəhrizad', 'Masa 6'))).toEqual([]);
    expect(unstyled(billLines(paid, 'Şəhrizad', 'Masa 6'))).toEqual([]);
    expect(unstyled(receiptLines(paid, 'Mağaza', undefined, { delivery: false }, true))).toEqual([]);
    expect(unstyled(returnReceiptLines(back, 'Mağaza', '45'))).toEqual([]);
    expect(unstyled(returnReceiptLines({ ...back, approvedBy: null, sellerName: null }, 'Mağaza', null))).toEqual([]);
  });
});

// The guest's paper is not the kitchen's: "Şərh: az duzlu" is for the cook
// (Natiq, 2026-11-22). The size and options the guest pays for stay.
describe('a dish\'s Şərh stays off the guest\'s paper', () => {
  const noted = {
    ...paid,
    items: [
      item('Şah plov', 18, 1, 'Şərh: az duzlu'),
      item('Şah plov', 18, 1, 'Şərh: soğansız'),
      item('Şah plov', 18, 1),
      item('Latte', 5, 2, 'Böyük · Şərh: şəkərsiz'),
      item('Latte', 5, 1, 'Böyük'),
    ],
  } as unknown as Order;
  const rows = (lines: Line[]) => lines.filter(l => l.style?.k === 'cols' && !l.style.head).map(l => l.style);
  it('receipt and bill: no note, same dishes on one line, options kept', () => {
    for (const lines of [receiptLines(noted, 'Ş'), billLines(noted, 'Ş'), receiptLines(noted, 'Ş', undefined, { delivery: false })]) {
      expect(lines.map(l => l.text).join('\n')).not.toMatch(/Şərh|duzlu|soğansız|şəkərsiz/);
      expect(rows(lines)).toEqual([
        { k: 'cols', cells: ['Şah plov', '3', '18.00', '54.00'], note: undefined },
        { k: 'cols', cells: ['Latte', '3', '5.00', '15.00'], note: 'Böyük' },
      ]);
    }
  });
});

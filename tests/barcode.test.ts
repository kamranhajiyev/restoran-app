// Mağaza modu, step 3 (SHOP-MODE.md): barcodes. A scan finds the product or
// its size and adds 1 (the same line again: +1); an unknown code says so.
// Admin keeps one barcode per product or per size, Excel carries it, Bazarlıq
// takes scans, and none of it breaks on a database without the column.

import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { addScannedLine, barcodeOwner, cleanBarcode, findByBarcode, scanCatcher, searchedFor, SCAN_GAP_MS } from '@/lib/barcode';
import { menuRowBatches } from '@/lib/set-items';
import { parseMenuFile } from '@/lib/excel';
import type { MenuItem } from '@/types';

const read = (p: string) => readFileSync(p, 'utf8');

const cappy: MenuItem = { id: 'c', name: 'Cappy', price: 2, category: 'İçki', available: true, barcode: '4600000000017' };
const fanta: MenuItem = {
  id: 'f', name: 'Fanta', price: 1, category: 'İçki', available: true, barcode: 'IGNORED',
  variants: [
    { id: 'v1', name: '0.33 L', price: 1, barcode: '5449000000439' },
    { id: 'v2', name: '1 L', price: 3, barcode: 'ABC-001' },
  ],
};
const menu = [cappy, fanta];

describe('a barcode', () => {
  it('is kept as written, letters and leading zeros too, without spaces or case', () => {
    expect(cleanBarcode(' 0046 000 ')).toBe('0046000');
    expect(cleanBarcode('abc-001')).toBe('ABC-001');
    expect(cleanBarcode(null)).toBe('');
  });

  it('finds a product, or the size it belongs to', () => {
    expect(findByBarcode(menu, '4600000000017')).toEqual({ item: cappy });
    expect(findByBarcode(menu, 'abc-001')).toEqual({ item: fanta, variant: fanta.variants![1] });
    expect(findByBarcode(menu, '9999')).toBeNull();
    expect(findByBarcode(menu, '')).toBeNull();
  });

  it('of a product with sizes is only its sizes\' own', () => {
    expect(findByBarcode(menu, 'IGNORED')).toBeNull();
  });

  it('already used by another product or size is named, but not the one being edited', () => {
    expect(barcodeOwner(menu, '4600000000017', { itemId: 'new' })).toBe('Cappy');
    expect(barcodeOwner(menu, '4600000000017', { itemId: 'c' })).toBeNull();
    expect(barcodeOwner(menu, 'abc-001', { itemId: 'new' })).toBe('Fanta (1 L)');
    expect(barcodeOwner(menu, 'abc-001', { itemId: 'f', variantId: 'v2' })).toBeNull();
    expect(barcodeOwner(menu, 'abc-001', { itemId: 'f', variantId: 'v1' })).toBe('Fanta (1 L)');
  });
});

describe('a scan anywhere on the till', () => {
  function run(keys: { k: string; at: number }[]) {
    let t = 0;
    const got: string[] = [];
    const c = scanCatcher(code => got.push(code), () => t);
    let ended = false;
    for (const { k, at } of keys) { t = at; if (k === 'Enter') ended = c.enter(); else c.key(k); }
    return { got, ended };
  }
  it('is fast keys ending in Enter', () => {
    const fast = [...'5449000000439'].map((k, i) => ({ k, at: i * 5 })).concat({ k: 'Enter', at: 70 });
    expect(run(fast)).toEqual({ got: ['5449000000439'], ended: true });
  });
  it('is not a person typing, nor a short burst', () => {
    const slow = [...'12345'].map((k, i) => ({ k, at: i * (SCAN_GAP_MS + 100) })).concat({ k: 'Enter', at: 2000 });
    expect(run(slow).got).toEqual([]);
    expect(run([{ k: '1', at: 0 }, { k: '2', at: 5 }, { k: 'Enter', at: 10 }]).got).toEqual([]);
  });
});

describe('the till', () => {
  const seller = read('app/seller/page.tsx');
  it('scans through the search box and anywhere on the products', () => {
    expect(seller).toMatch(/if \(e\.key === 'Enter' && menuSearch\.trim\(\)\) \{ e\.preventDefault\(\); scanned\(menuSearch\); \}/);
    expect(seller).toMatch(/const catcher = scanCatcher\(code => scannedRef\.current\(code\), Date\.now,/);
    expect(seller).toMatch(/showAlert\(`Barkod tapılmadı: \$\{raw\.trim\(\)\}`\)/);
    // A size goes in as that size, through addToCart's same-line +1.
    expect(seller).toMatch(/addToCart\(\{ \.\.\.hit\.item, price: v\.price \}, v\.name, v\.id\)/);
  });
  it('says "Barkod skan et" in a shop', () => {
    expect(seller).toMatch(/isShop \? 'Barkod skan et və ya məhsul axtar\.\.\.' : 'Məhsul axtar\.\.\.'/);
  });
});

// The open category was taken for search results: its only product was sold for
// a barcode nobody knew, and with several there was no message (2026-11-24).
describe('a code nobody knows', () => {
  it('scanned outside the search box stands for nothing, whatever is on the screen', () => {
    expect(searchedFor('4600123456789', '', ['Cappy'])).toEqual([]);
    expect(searchedFor('4600123456789', 'col', ['Cola'])).toEqual([]);   // an older search left in the box
  });
  it('typed in the search box is a search', () => {
    expect(searchedFor('cap', 'cap ', ['Cappy'])).toEqual(['Cappy']);
    expect(searchedFor('4600123456789', '4600123456789', [])).toEqual([]);
  });
  it('is asked that way by the till, for a sale and for Qaytarma', () => {
    const seller = read('app/seller/page.tsx');
    const fn = seller.slice(seller.indexOf('function scanned(raw: string)'), seller.indexOf('// Read on opening, every minute'));
    expect(fn).toMatch(/const searched = searchedFor\(raw, menuSearch, filtered\);/);
    expect(fn.match(/\bfiltered\b/g)).toHaveLength(1);
  });
});

describe('saving', () => {
  it('leaves the barcode out of rows that did not load it, so the database keeps its own', () => {
    const known = { id: 'a', barcode: '1' };
    const unknown = { id: 'b' };
    expect(menuRowBatches([known, unknown, { id: 'c', barcode: null }])).toEqual([[known, { id: 'c', barcode: null }], [unknown]]);
    expect(read('lib/store.ts')).toMatch(/\.\.\.\(m\.barcode !== undefined \? \{ barcode: cleanBarcode\(m\.barcode\) \|\| null \} : \{\}\)/);
  });
  it('asks the database whether the column exists, so a new shop\'s first product keeps its barcode', () => {
    const admin = read('app/admin/page.tsx');
    expect(admin).toMatch(/menuHasBarcode\(\)\.then\(setBarcodesLoaded\)/);
    expect(admin).toMatch(/barcode: barcodesLoaded \? \(form\.hasVariants \? null : \(cleanBarcode\(form\.barcode\) \|\| null\)\) : undefined/);
  });
  it('reaches link tills and the exe/APK, read apart so an older database still sends the menu', () => {
    const route = read('app/api/public-menu/route.ts');
    expect(route).toMatch(/select\('id, barcode'\)/);
    expect(route).toMatch(/barcode: barcodeOf\.get\(r\.id as string\) \?\? undefined/);
    expect(route).not.toMatch(/select\('id, name, price[^']*barcode/);
  });
});

describe('Excel', () => {
  function file(rows: Record<string, unknown>[]): File {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Menyu');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    return new File([buf], 'menyu.xlsx');
  }
  it('reads a Barkod column for new and existing products', async () => {
    const p = await parseMenuFile(file([
      { 'Kateqoriya': 'İçki', 'Məhsul': 'Cappy', 'Qiymət (₼)': 2, 'Barkod': '0046 111' },
      { 'Kateqoriya': 'İçki', 'Məhsul': 'Su', 'Qiymət (₼)': 0.5, 'Barkod': '777' },
    ]), [cappy], [{ name: 'İçki', available: true }]);
    expect(p.updatedItems[0].barcode).toBe('0046111');
    expect(p.newItems[0].barcode).toBe('777');
  });
  it('without the column, leaves barcodes alone — and keeps each size\'s', async () => {
    const p = await parseMenuFile(file([
      { 'Kateqoriya': 'İçki', 'Məhsul': 'Fanta', 'Qiymət (₼)': 1, 'Variantlar': '0.33 L=1 | 1 L=3' },
    ]), [fanta], [{ name: 'İçki', available: true }]);
    expect(p.updatedItems[0].barcode).toBe('IGNORED');
    expect(p.updatedItems[0].variants!.map(v => v.barcode)).toEqual(['5449000000439', 'ABC-001']);
  });
});

describe('Bazarlıq', () => {
  type L = { stockItemId: string; qty: string; unitCost: string };
  const blank = { unitCost: '' };
  it('fills the empty first line, then adds 1 to a line already there', () => {
    let lines: L[] = [{ stockItemId: 'first-in-list', qty: '', unitCost: '' }];
    lines = addScannedLine(lines, 's1', blank);
    expect(lines).toEqual([{ stockItemId: 's1', qty: '1', unitCost: '' }]);
    lines = addScannedLine(lines, 's1', blank);
    expect(lines).toEqual([{ stockItemId: 's1', qty: '2', unitCost: '' }]);
    lines = addScannedLine(lines, 's2', blank);
    expect(lines).toEqual([{ stockItemId: 's1', qty: '2', unitCost: '' }, { stockItemId: 's2', qty: '1', unitCost: '' }]);
  });
  it('shows the scan box only once a product has a barcode', () => {
    expect(read('components/AnbarPanel.tsx')).toMatch(/\{Object\.keys\(codes\)\.length > 0 && \(/);
  });
});

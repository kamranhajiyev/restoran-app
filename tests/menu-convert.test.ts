// Another POS's export (Clopos or Poster) becomes the import file through one
// function (lib/menu-convert.ts), and the import's own reader must accept it.

import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { parseMenuFile } from '@/lib/excel';
import { convertMenu, convertMenuPage, detectSource, type ConvertConfig } from '@/lib/menu-convert';
import { menuTextWorkbook } from '@/lib/menu-text';
import { menuPageUrl } from '@/lib/menu-images';

function book(sheets: Record<string, unknown[][]>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return wb;
}

async function imported(wb: XLSX.WorkBook, cfg: ConvertConfig, products?: XLSX.WorkBook) {
  const result = convertMenu(wb, cfg, products);
  const buf = XLSX.write(menuTextWorkbook(result), { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const p = await parseMenuFile(new File([buf], 'menu.xlsx'), [], []);
  expect(p.errors).toEqual([]);
  return { result, items: p.newItems.map(m => [m.name, m.category, m.price, m.costPrice, m.kind]) };
}

const clopos = () => book({
  Products: [
    ['Type', 'Name', 'Price', 'Category', 'Station', 'Cost price'],
    ['GOODS', 'Coca Cola 1L', 3, 'Soyuq İçkilər', 'Bar', 0],
    ['GOODS', 'Pizza  Sadə', 9, 'Pizza', '', 0],                 // GOODS, but cooked
    ['DISH', 'Fanta 250 Ml', 2.5, 'Soyuq İçkilər', '', 0.8],     // DISH, but a bottle
    ['GOODS', 'Snickers 50 Gr', 3.5, 'Çay', '', 0],
    ['GOODS', 'Set (Çay,Paxlava,Qelyan)', 14.9, 'Setlər', '', 0],
  ],
  Modificators: [['Type', 'Name', 'Min', 'Max', 'Price', 'Default', 'Brutto']],
});

describe('menu converter', () => {
  it('reads a Clopos export, with Növ from the config and not from GOODS/DISH', async () => {
    const cfg: ConvertConfig = {
      name: 'Test', setCategories: ['setlər'], productCategories: ['soyuq içkilər'], productNames: ['snickers'],
    };
    const { result, items } = await imported(clopos(), cfg);
    expect(result.source).toBe('clopos');
    expect(items).toEqual([
      ['Coca Cola 1L', 'Soyuq İçkilər', 3, undefined, 'product'],
      ['Pizza Sadə', 'Pizza', 9, undefined, 'meal'],
      ['Fanta 250 Ml', 'Soyuq İçkilər', 2.5, 0.8, 'product'],
      ['Snickers 50 Gr', 'Çay', 3.5, undefined, 'product'],
      ['Set (Çay,Paxlava,Qelyan)', 'Setlər', 14.9, undefined, 'set'],
    ]);
    expect(result.notes).toEqual(['1 sets come in without their parts; pick the parts in admin.']);
  });

  it('matches a category written with İ in the file and i in the config', () => {
    const { rows } = convertMenu(clopos(), { name: 'Test', productCategories: ['SOYUQ içkilər'] });
    expect(rows[0]['Növ']).toBe('Məhsul');
  });

  it('reads a Poster export with sizes under the dish', async () => {
    const wb = book({
      Menu: [
        ['Poster export'], ['', 'Ad', 'Kateqoriya', 'Qiymət'],
        ['', 'Latte', 'Qəhvə', ''],
        ['', 'Kiçik', '', 4],
        ['', 'Böyük', '', 5.5],
        ['', 'Su', 'İçkilər', 1],
      ],
    });
    expect(detectSource(wb)).toBe('poster');
    const cfg: ConvertConfig = { name: 'Test', headerRows: 2, columns: { name: 1, category: 2, price: 3 }, productCategories: ['içkilər'] };
    const { items, result } = await imported(wb, cfg);
    expect(items).toEqual([['Latte', 'Qəhvə', 4, undefined, 'meal'], ['Su', 'İçkilər', 1, undefined, 'product']]);
    expect(result.rows[0]['Variantlar']).toBe('Kiçik=4 | Böyük=5.5');
  });

  it('takes Növ from the file when Poster splits dishes and products, but a set category still wins', async () => {
    const sheet = (rows: unknown[][]) => book({ S: [['h'], ...rows] });
    const src = { headerRows: 1, columns: { name: 0, category: 1, price: 2 } };
    const cfg: ConvertConfig = { name: 'Test', dishes: src, products: src, setCategories: ['Setlər'], productCategories: ['Qəlyanaltı'] };
    const { items } = await imported(
      sheet([['Plov', 'Qəlyanaltı', 8], ['Ailə seti', 'Setlər', 30]]),
      cfg,
      sheet([['Cola', 'İçki', 2]]),
    );
    expect(items.map(i => i[4])).toEqual(['meal', 'set', 'product']);
  });
});

const PSME = "https://menu.ps.me/SWoDd4Ipp8E";

describe("convertMenuPage (menu.ps.me)", () => {
  const page = `<script id="menu-data" type="application/json">[
    {"name":"Basdırma et","categoryName":"Pive cerezleri","price":5,"photo":null},
    {"name":"Tum","categoryName":"Pive cerezleri","price":2,"photo":null},
    {"name":"Red Bull","categoryName":"Soyuq İçkiler","price":5,"photo":null},
    {"name":"Set 3. ( Qelyan, Cola 1Lt,Tum )","categoryName":"Qelyan setleri","price":12.9,"photo":null}
  ]</script>`;
  const cfg: ConvertConfig = {
    name: 'Çinar Lounge',
    setCategories: ['Qelyan setleri'],
    productCategories: ['Soyuq İçkiler'],
    productNames: ['Tum'],
  };

  it('makes the import file from the page, with Növ from the config', async () => {
    const result = convertMenuPage(page, PSME, cfg);
    expect(result.source).toBe('psme');
    expect(result.rows.map(r => [r['Məhsul'], r['Növ']])).toEqual([
      ['Basdırma et', 'Yemək'], ['Tum', 'Məhsul'], ['Red Bull', 'Məhsul'], ['Set 3. ( Qelyan, Cola 1Lt,Tum )', 'Set'],
    ]);
    const buf: Buffer = XLSX.write(menuTextWorkbook(result), { type: 'buffer', bookType: 'xlsx' });
    const preview = await parseMenuFile(new File([new Uint8Array(buf)], 'm.xlsx'), [], []);
    expect(preview.errors).toEqual([]);
    expect(preview.newItems.map(i => i.price)).toEqual([5, 2, 5, 12.9]);
  });

  it('refuses a page with no menu on it', () => {
    expect(() => convertMenuPage("<html></html>", PSME, cfg)).toThrow(/No products/);
  });
});

describe('convertMenuPage (a site with schema.org data)', () => {
  const ld = (name: string, category: string, price: string) =>
    ({ '@type': 'ListItem', item: { '@type': 'Product', name, category, offers: { price } } });
  const page = `<script type="application/ld+json">${JSON.stringify({ '@type': 'ItemList', itemListElement: [
    ld('Dana ətli lavaş', 'Ət Dönəri', '3.60'),
    ld('Cola / Fanta / Sprite (dəmər banka)', 'Soyuq İçkilər', '2.00'),
  ] })}</script>`;
  const cfg: ConvertConfig = {
    name: 'Odessa Döner',
    productCategories: ['Soyuq İçkilər'],
    rename: [['Ət Dönəri', 'Dana Əti Dönəri'], ['Dana ətli', 'Dana əti'], ['dəmər', 'dəmir']],
  };

  it('writes the fixed spellings, with Növ from the config, and the import reads it', async () => {
    const result = convertMenuPage(page, 'https://odessadoner.com/menu', cfg);
    expect(result.source).toBe('jsonld');
    expect(result.rows.map(r => [r['Kateqoriya'], r['Məhsul'], r['Növ']])).toEqual([
      ['Dana Əti Dönəri', 'Dana əti lavaş', 'Yemək'],
      ['Soyuq İçkilər', 'Cola / Fanta / Sprite (dəmir banka)', 'Məhsul'],
    ]);
    const buf: Buffer = XLSX.write(menuTextWorkbook(result), { type: 'buffer', bookType: 'xlsx' });
    const preview = await parseMenuFile(new File([new Uint8Array(buf)], 'm.xlsx'), [], []);
    expect(preview.errors).toEqual([]);
    expect(preview.newItems.map(i => i.price)).toEqual([3.6, 2]);
  });
});

// A Clopos e-menu carries the whole menu as escaped JSON inside a script string.
const cloposPage = (data: unknown) =>
  `<script>self.__next_f.push([1,"x:{\\"menuData\\":${JSON.stringify(data).replace(/\\/g, '\\\\').replace(/"/g, '\\"')},\\"venueId\\":\\"1\\"}"])</script>`;

describe('convertMenuPage (a Clopos e-menu link)', () => {
  const p = (id: number, name: string, price: number | null, cat: number | null, extra = {}) =>
    ({ id, name, full_name: name, price, category_id: cat, emenu_category_id: cat, emenu_position: null, media: [], ...extra });
  const page = cloposPage({
    categories: [
      { id: 7, name: 'Pizza', emenu_position: 1 },
      { id: 13, name: 'Serin içkilər', emenu_position: 0 },
    ],
    products: [
      p(1, 'Margaritta', 9.9, 7, { meta: { availability: { schedules: { itemVisibility: [] } } } }),
      p(2, 'Coca "Cola" 1L', 3, 13),
      p(3, 'Buz', 1, 22),               // a category hidden from the e-menu
      p(4, 'fanta 1l', 3.5, null),       // in no category: not on their e-menu
      p(5, 'margaritta ', 8, 7),         // the same name again
    ],
  });
  const URL_ = 'https://sslounge.clopos.menu/az/1/products';

  it('reads names, categories in e-menu order and prices, and the import takes it', async () => {
    const result = convertMenuPage(page, URL_, { name: 'SS Lounge', productCategories: ['Serin içkilər'] });
    expect(result.source).toBe('clopos-page');
    expect(result.rows.map(r => [r['Kateqoriya'], r['Məhsul'], r['Qiymət (₼)'], r['Növ']])).toEqual([
      ['Serin içkilər', 'Coca "Cola" 1L', 3, 'Məhsul'],
      ['Pizza', 'Margaritta', 9.9, 'Yemək'],
      ['Digər', 'Buz', 1, 'Yemək'],
    ]);
    expect(result.notes.join('\n')).toMatch(/fanta 1l/);
    expect(result.notes.join('\n')).toMatch(/margaritta/);
    const buf: Buffer = XLSX.write(menuTextWorkbook(result), { type: 'buffer', bookType: 'xlsx' });
    const preview = await parseMenuFile(new File([new Uint8Array(buf)], 'm.xlsx'), [], []);
    expect(preview.errors).toEqual([]);
  });

  it('refuses a Clopos page with no menu data on it', () => {
    expect(() => convertMenuPage('<html></html>', URL_, { name: 'x' })).toThrow(/No products/);
  });
});

describe('convertMenuPage (a monyo.az link)', () => {
  const card = (name: string, price: string) => `
    <div class="product-card " data-product-id="1">
      <div class="product-content"><h3 class="product-name">${name}</h3>
        <div class="product-footer "><div class="product-price" data-price="${price}" data-discount="0">${price} ₼</div></div>
      </div>
    </div>`;
  const page = `<h2 class="category-title">Kabablar</h2>${card('Lülə Kabab', '9')}${card('Tikə &amp; Kartof', '10.5')}`
    + `<h2 class="category-title">Sərin İçkilər</h2>${card('Kola', '2')}`;

  it('takes each card under the heading above it, with its price', () => {
    const result = convertMenuPage(page, 'https://monyo.az/v4/?r=cinarrestoran', { name: 'Çinar', productCategories: ['Sərin İçkilər'] });
    expect(result.source).toBe('monyo');
    expect(result.rows.map(r => [r['Kateqoriya'], r['Məhsul'], r['Qiymət (₼)'], r['Növ']])).toEqual([
      ['Kabablar', 'Lülə Kabab', 9, 'Yemək'],
      ['Kabablar', 'Tikə & Kartof', 10.5, 'Yemək'],
      ['Sərin İçkilər', 'Kola', 2, 'Məhsul'],
    ]);
  });
});

describe('menuPageUrl', () => {
  it('sends any Clopos e-menu page to the one that carries the menu, and leaves other links alone', () => {
    expect(menuPageUrl('https://sslounge.clopos.menu/az/1/home')).toBe('https://sslounge.clopos.menu/az/1/products');
    expect(menuPageUrl('https://sslounge.clopos.menu/az/1/categories')).toBe('https://sslounge.clopos.menu/az/1/products');
    expect(menuPageUrl('https://sslounge.clopos.menu/az/1/products')).toBe('https://sslounge.clopos.menu/az/1/products');
    expect(menuPageUrl('https://monyo.az/v4/?r=cinar')).toBe('https://monyo.az/v4/?r=cinar');
  });
});

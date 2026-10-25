import { describe, expect, it } from 'vitest';
import {
  applyRenames, jsonLdProducts, matchPictures, parseCloposPage, parseMenuPage, parseMonyoPage, pictureKey, pictureStoragePath, psMeProducts,
} from '@/lib/menu-images';

// The shape a Clopos e-menu page carries its products in: JSON with escaped quotes.
const product = (name: string, media: string) =>
  `\\"full_name\\":\\"${name}\\",\\"slug\\":\\"x\\",\\"media\\":[${media}]`;
const pic = (id: string) =>
  `{\\"uuid\\":\\"${id}\\",\\"urls\\":{\\"original\\":\\"https://cdn.clopos.com/r/${id}/original.jpg\\",` +
  `\\"extra_large\\":\\"https://cdn.clopos.com/r/${id}/extra_large.jpg\\",\\"thumb\\":\\"https://cdn.clopos.com/r/${id}/thumb.jpg\\"}}`;

const html = [
  product('Coca Cola 1L', pic('a1')),
  product('Kabab (toyuq file)', ''),
  product('Coca Cola 1L', pic('dup')), // the page lists a product more than once
].join(',');

describe('parseCloposPage', () => {
  it('reads every product once, with its extra-large picture', () => {
    expect(parseCloposPage(html)).toEqual([
      { name: 'Coca Cola 1L', imageUrl: 'https://cdn.clopos.com/r/a1/extra_large.jpg' },
      { name: 'Kabab (toyuq file)', imageUrl: null },
    ]);
  });
});

describe('parseMonyoPage', () => {
  const card = (name: string, img: string) => `
    <div class="product-card " data-product-id="1">
      ${img ? `<div class="product-image-container"><img loading="lazy" src="${img}"
          alt="${name}" class="product-image"></div>` : ''}
      <div class="product-content"><h3 class="product-name">${name}</h3></div>
    </div>`;
  const page = 'https://monyo.az/v4/?r=cinarrestoran';

  it('reads each card once, with the picture as a full link on the site', () => {
    const html = card('Milli Səhər Yeməyi', 'uploads/a_84_1.jpg') + card('Çay &amp; Limon', '') + card('Milli Səhər Yeməyi', 'uploads/x.jpg');
    expect(parseMonyoPage(html, page)).toEqual([
      { name: 'Milli Səhər Yeməyi', imageUrl: 'https://monyo.az/uploads/a_84_1.jpg' },
      { name: 'Çay & Limon', imageUrl: null },
    ]);
  });

  it('is picked by the link, and a site with no menu on it is refused', () => {
    expect(parseMenuPage(card('Kofe', 'uploads/k.jpg'), page)).toHaveLength(1);
    expect(() => parseMenuPage('', 'https://example.com/menu')).toThrow();  // no menu data on it
  });
});

describe('matchPictures', () => {
  const page = parseCloposPage(html);

  it('pairs by name, ignoring trailing spaces and case, and lists what is left', () => {
    const m = matchPictures([
      { id: '1', name: 'coca cola 1L ', image: null },
      { id: '2', name: 'Kabab (toyuq file)', image: null },
      { id: '3', name: 'yoxlama', image: null },
    ], page);
    expect(m.matched).toEqual([{ id: '1', name: 'coca cola 1L ', imageUrl: 'https://cdn.clopos.com/r/a1/extra_large.jpg' }]);
    expect(m.noPicture).toEqual(['Kabab (toyuq file)']);
    expect(m.notOnPage).toEqual(['yoxlama']);
  });

  it('keeps a picture a product already has, so a second run uploads nothing', () => {
    const products = [{ id: '1', name: 'Coca Cola 1L', image: 'https://x/menu-images/c/1.jpg' }];
    expect(matchPictures(products, page).matched).toEqual([]);
    expect(matchPictures(products, page).kept).toEqual(['Coca Cola 1L']);
    expect(matchPictures(products, page, { replace: true }).matched).toHaveLength(1);
  });
});

describe('pictureStoragePath', () => {
  it("puts the picture in the company's own folder, like a picture uploaded in admin", () => {
    expect(pictureStoragePath('co-1', 'jpg', 1000, 'abcdef12-3456')).toBe('co-1/1000-abcdef12.jpg');
    expect(pictureStoragePath('co-1', '', 1000, 'abcdef12')).toBe('co-1/1000-abcdef12.jpg');
  });

  it('keys names the same however they are spaced', () => {
    expect(pictureKey('  Set ( 2 Çay,  4 Paxlava) ')).toBe(pictureKey('set ( 2 çay, 4 paxlava)'));
  });
});

describe('menu.ps.me (Poster online menu)', () => {
  const page = `<html><script id="settings-data" type="application/json">{"shopName":"X"}</script>
    <script id="menu-data" type="application/json">
      [{"name":"Basdırma et","categoryName":"Pive cerezleri","photo":"https://img.postershop.me/a.png","price":5},
       {"name":"Boğaz \\"Qızardılmış\\"","categoryName":"Pive cerezleri","photo":"https://img.postershop.me/b.jpeg","price":4.5},
       {"name":"Potene","categoryName":"Pive cerezleri","photo":null,"price":5.5},
       {"name":"Basdırma  et ","categoryName":"Pive cerezleri","photo":null,"price":5}]
    </script></html>`;

  it('reads every product once, with its category, price and picture', () => {
    expect(psMeProducts(page)).toEqual([
      { name: 'Basdırma et', category: 'Pive cerezleri', price: 5, photo: 'https://img.postershop.me/a.png' },
      { name: 'Boğaz "Qızardılmış"', category: 'Pive cerezleri', price: 4.5, photo: 'https://img.postershop.me/b.jpeg' },
      { name: 'Potene', category: 'Pive cerezleri', price: 5.5, photo: null },
    ]);
  });

  it('is picked by parseMenuPage from the link', () => {
    expect(parseMenuPage(page, 'https://menu.ps.me/SWoDd4Ipp8E').map(p => p.imageUrl))
      .toEqual(['https://img.postershop.me/a.png', 'https://img.postershop.me/b.jpeg', null]);
  });

  it('finds nothing on a page without the menu data', () => {
    expect(psMeProducts('<html></html>')).toEqual([]);
  });
});

describe("a restaurant's own site (schema.org data)", () => {
  const PAGE = 'https://odessadoner.com/menu';
  const ld = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
  const product = (name: string, category: string, price: string, image?: unknown) =>
    ({ '@type': 'ListItem', item: { '@type': 'Product', name, category, image, offers: { '@type': 'Offer', price } } });
  const html = ld({ '@type': 'Organization', name: 'Odessa Döner', logo: '/logo.png' }) + ld([{
    '@type': 'ItemList', itemListElement: [
      product('Toyuq çörək', 'Toyuq Dönəri', '2.20', ['https://res.cloudinary.com/x/a.jpg']),
      product('Dana ətli  lavaş', 'Ət Dönəri', '3.60', '/img/b.jpg'),
      product('Borş', 'Şorbalar', '3.50'),
      product('Toyuq çörək', 'Toyuq Dönəri', '9'),
    ],
  }]) + '<script type="application/ld+json">{broken</script>';

  it('reads every product once, with category, price and a full picture link', () => {
    expect(jsonLdProducts(html, PAGE)).toEqual([
      { name: 'Toyuq çörək', category: 'Toyuq Dönəri', price: 2.2, photo: 'https://res.cloudinary.com/x/a.jpg' },
      { name: 'Dana ətli lavaş', category: 'Ət Dönəri', price: 3.6, photo: 'https://odessadoner.com/img/b.jpg' },
      { name: 'Borş', category: 'Şorbalar', price: 3.5, photo: null },
    ]);
  });

  it('reads a schema.org Menu too, a dish taking its section as category', () => {
    const menu = ld({ '@type': 'Menu', hasMenuSection: [{ '@type': 'MenuSection', name: 'Salatlar', hasMenuItem: [
      { '@type': 'MenuItem', name: 'Çoban salatı', image: { url: 'https://x/c.jpg' }, offers: [{ price: 3 }] },
    ] }] });
    expect(jsonLdProducts(menu, PAGE)).toEqual([{ name: 'Çoban salatı', category: 'Salatlar', price: 3, photo: 'https://x/c.jpg' }]);
  });

  it('is picked by parseMenuPage for any other site, which is refused only when it has no menu data', () => {
    expect(parseMenuPage(html, PAGE).map(p => p.name)).toEqual(['Toyuq çörək', 'Dana ətli lavaş', 'Borş']);
    expect(() => parseMenuPage('<html></html>', PAGE)).toThrow(/No menu found/);
  });

  it("applies a company's spelling fixes, so renamed dishes still find their picture", () => {
    const renames: [string, string][] = [['Dana ətli', 'Dana əti'], ['Mərcə', 'Mərci']];
    expect(applyRenames('Dana ətli lavaş + Mərcə şorbası', renames)).toBe('Dana əti lavaş + Mərci şorbası');
    const page = parseMenuPage(html, PAGE).map(p => ({ ...p, name: applyRenames(p.name, renames) }));
    expect(matchPictures([{ id: '1', name: 'Dana əti lavaş', image: null }], page).matched).toHaveLength(1);
    expect(applyRenames('Borş')).toBe('Borş');
  });
});

// Pictures for a menu that was imported from another restaurant's online menu.
//
// The online menu (a Clopos e-menu, a monyo.az page, a Poster menu.ps.me page, or a
// restaurant's own site with schema.org data) shows each product with its
// picture. These functions read that page and pair each picture with our own
// product of the same name. Downloading and uploading live in
// scripts/menu-images.ts; everything here is plain logic so it can be tested.

export type PagePicture = { name: string; imageUrl: string | null };
export type OurProduct = { id: string; name: string; image: string | null };

export type PictureMatch = {
  /** Products that get a picture. */
  matched: { id: string; name: string; imageUrl: string }[];
  /** On the page, but the page has no picture for them. */
  noPicture: string[];
  /** Not on the page at all. */
  notOnPage: string[];
  /** Already have a picture; left alone unless `replace`. */
  kept: string[];
};

/** Names are matched after trimming, collapsing spaces and ignoring case,
 *  because exports often carry a trailing space the page does not. */
export function pictureKey(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Every product on a Clopos e-menu page (…clopos.menu/az/1/products) with
 *  its largest web picture. The page carries its data as escaped JSON. */
export function parseCloposPage(html: string): PagePicture[] {
  const text = html.replace(/\\"/g, '"');
  const seen = new Set<string>();
  const out: PagePicture[] = [];
  const product = /"full_name":"((?:[^"\\]|\\.)*)","slug":"[^"]*","media":\[(.*?)\]/g;
  for (const m of text.matchAll(product)) {
    const name = m[1].replace(/\\(.)/g, '$1');
    const key = pictureKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    const urls = /"urls":\{(.*?)\}/.exec(m[2]);
    const sizes = Object.fromEntries(
      [...(urls?.[1] ?? '').matchAll(/"(\w+)":"(https:\/\/[^"]+)"/g)].map(u => [u[1], u[2]]),
    );
    out.push({ name, imageUrl: sizes.extra_large ?? sizes.original ?? null });
  }
  return out;
}

const decodeHtml = (s: string) => s
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Every product on a monyo.az menu page (monyo.az/v4/?r=<restaurant>). Each
 *  product is a plain HTML card; its picture path is relative to the site. */
export function parseMonyoPage(html: string, pageUrl: string): PagePicture[] {
  return monyoProducts(html, pageUrl).map(p => ({ name: p.name, imageUrl: p.photo }));
}

export type PsMeProduct = { name: string; category: string; price: number | null; photo: string | null };

/** The same monyo.az page with categories and prices, for the converter. A
 *  category is an <h2 class="category-title"> followed by its cards; the
 *  price is the card's data-price. */
export function monyoProducts(html: string, pageUrl: string): PsMeProduct[] {
  const origin = new URL(pageUrl).origin;
  const seen = new Set<string>();
  const out: PsMeProduct[] = [];
  html.split('<h2 class="category-title">').forEach((section, i) => {
    const category = i === 0 ? '' : decodeHtml(section.slice(0, section.indexOf('</h2>'))).replace(/\s+/g, ' ').trim();
    for (const card of section.split('class="product-card').slice(1)) {
      const name = /class="product-name">([\s\S]*?)<\/h3>/.exec(card)?.[1];
      if (!name) continue;
      const clean = decodeHtml(name).replace(/\s+/g, ' ').trim();
      const key = pictureKey(clean);
      if (seen.has(key)) continue;
      seen.add(key);
      const src = /<img[^>]*?src="([^"]+)"[^>]*class="product-image"/.exec(card)?.[1];
      const price = parseFloat(/data-price="([^"]*)"/.exec(card)?.[1] ?? '');
      out.push({
        name: clean,
        category,
        price: isNaN(price) || price < 0 ? null : Math.round(price * 100) / 100,
        photo: src ? new URL(src.replace(/^\/?/, '/'), origin).href : null,
      });
    }
  });
  return out;
}

/** The JSON value right after `"key":` in a text, read to its closing bracket. */
function jsonAfter(text: string, key: string): unknown {
  const at = text.indexOf(`"${key}":`);
  if (at === -1) return null;
  const start = at + key.length + 3;
  let depth = 0, inString = false;
  for (let k = start; k < text.length; k++) {
    const c = text[k];
    if (inString) {
      if (c === '\\') k++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{' || c === '[') depth++;
    else if ((c === '}' || c === ']') && --depth === 0) {
      try { return JSON.parse(text.slice(start, k + 1)); } catch { return null; }
    }
  }
  return null;
}

type CloposCategory = { id: number; name: string; emenu_position: number | null };
type CloposProduct = {
  id: number; name: string; full_name?: string; price: number | null;
  category_id: number | null; emenu_category_id: number | null; emenu_position: number | null;
  media?: { urls?: Record<string, string> }[];
};

export type CloposMenu = {
  products: PsMeProduct[];
  /** In the POS but in no category, so the e-menu does not show them. Left out. */
  noCategory: string[];
  /** A second product with a name already read, left out (the import keeps one row per name). */
  sameName: string[];
};

/** Every product on a Clopos e-menu (…clopos.menu/az/1/products) with its
 *  category and price. The page carries the whole menu as escaped JSON under
 *  "menuData"; a category hidden from the e-menu is not in its list, so its
 *  products come in under "Digər". */
export function cloposMenu(html: string): CloposMenu {
  const text = html.replace(/\\\\/g, '\u0000').replace(/\\"/g, '"').replace(/\u0000/g, '\\');
  const data = jsonAfter(text, 'menuData') as { categories?: CloposCategory[]; products?: CloposProduct[] } | null;
  const result: CloposMenu = { products: [], noCategory: [], sameName: [] };
  if (!data?.products) return result;

  const cats = new Map((data.categories ?? []).map(c => [c.id, c]));
  const catOf = (p: CloposProduct) => p.emenu_category_id ?? p.category_id;
  const rank = (p: CloposProduct) => cats.get(catOf(p)!)?.emenu_position ?? Number.MAX_SAFE_INTEGER;
  const sorted = data.products
    .filter(p => {
      if (catOf(p) !== null) return true;
      result.noCategory.push(p.full_name ?? p.name);
      return false;
    })
    .sort((a, b) => rank(a) - rank(b) || (a.emenu_position ?? 0) - (b.emenu_position ?? 0) || a.id - b.id);

  const seen = new Set<string>();
  for (const p of sorted) {
    const name = (p.full_name || p.name || '').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    if (seen.has(pictureKey(name))) { result.sameName.push(name); continue; }
    seen.add(pictureKey(name));
    const urls = p.media?.[0]?.urls ?? {};
    result.products.push({
      name,
      category: cats.get(catOf(p)!)?.name.trim() || 'Digər',
      price: typeof p.price === 'number' && p.price >= 0 ? Math.round(p.price * 100) / 100 : null,
      photo: urls.extra_large ?? urls.original ?? null,
    });
  }
  return result;
}

/** A Clopos e-menu link to any of its pages (…/az/1/home, …/categories) points
 *  at …/products, the one page that carries the whole menu. Other links are kept. */
export function menuPageUrl(url: string): string {
  const u = new URL(url);
  if (!u.hostname.endsWith('clopos.menu')) return url;
  const m = /^\/([a-z]{2})\/(\d+)(?:\/|$)/.exec(u.pathname);
  return m ? `${u.origin}/${m[1]}/${m[2]}/products` : url;
}

/** Every product on a Poster online menu (menu.ps.me/<id>), which carries the
 *  whole menu as JSON in a <script id="menu-data"> tag. Also feeds the converter. */
export function psMeProducts(html: string): PsMeProduct[] {
  const json = /<script id="menu-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!json) return [];
  const rows = JSON.parse(json) as { name?: string; categoryName?: string; price?: number; photo?: string | null }[];
  const seen = new Set<string>();
  const out: PsMeProduct[] = [];
  for (const r of rows) {
    const name = (r.name ?? '').replace(/\s+/g, ' ').trim();
    if (!name || seen.has(pictureKey(name))) continue;
    seen.add(pictureKey(name));
    out.push({
      name,
      category: (r.categoryName ?? '').trim(),
      price: typeof r.price === 'number' ? r.price : null,
      photo: r.photo || null,
    });
  }
  return out;
}

type Json = Record<string, unknown>;

const isType = (o: Json, t: string) => ([] as unknown[]).concat(o['@type']).includes(t);

function firstImage(image: unknown, pageUrl: string): string | null {
  const first = ([] as unknown[]).concat(image)[0];
  const src = typeof first === 'string' ? first : (first as Json | undefined)?.url;
  return typeof src === 'string' && src ? new URL(src, pageUrl).href : null;
}

function offerPrice(offers: unknown): number | null {
  const first = ([] as unknown[]).concat(offers)[0] as Json | undefined;
  const n = parseFloat(String(first?.price ?? '').replace(',', '.'));
  return isNaN(n) || n < 0 ? null : Math.round(n * 100) / 100;
}

/** Every Product or MenuItem in a page's schema.org data (<script type="application/ld+json">),
 *  which many restaurants' own sites carry for Google (odessadoner.com/menu).
 *  A MenuItem without its own category takes the name of the MenuSection it sits in. */
export function jsonLdProducts(html: string, pageUrl: string): PsMeProduct[] {
  const seen = new Set<string>();
  const out: PsMeProduct[] = [];
  const walk = (node: unknown, section: string) => {
    if (Array.isArray(node)) { node.forEach(n => walk(n, section)); return; }
    if (!node || typeof node !== 'object') return;
    const o = node as Json;
    if ((isType(o, 'Product') || isType(o, 'MenuItem')) && typeof o.name === 'string') {
      const name = decodeHtml(o.name).replace(/\s+/g, ' ').trim();
      if (name && !seen.has(pictureKey(name))) {
        seen.add(pictureKey(name));
        out.push({
          name,
          category: typeof o.category === 'string' ? o.category.trim() : section,
          price: offerPrice(o.offers),
          photo: firstImage(o.image, pageUrl),
        });
      }
      return;
    }
    const inside = isType(o, 'MenuSection') && typeof o.name === 'string' ? o.name.trim() : section;
    Object.values(o).forEach(v => walk(v, inside));
  };
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try { walk(JSON.parse(m[1]), ''); } catch { /* a broken block says nothing about the menu */ }
  }
  return out;
}

/** Products with their category and price, from a page that carries them:
 *  a Clopos e-menu, a monyo.az page, a Poster menu.ps.me page, or any site
 *  with schema.org data. Feeds the converter. */
export function pageProducts(html: string, pageUrl: string): PsMeProduct[] {
  const host = new URL(pageUrl).hostname;
  if (host.endsWith('clopos.menu')) return cloposMenu(html).products;
  if (host.endsWith('monyo.az')) return monyoProducts(html, pageUrl);
  return host === 'menu.ps.me' ? psMeProducts(html) : jsonLdProducts(html, pageUrl);
}

/** Reads whichever kind of online menu the link points at. */
export function parseMenuPage(html: string, pageUrl: string): PagePicture[] {
  const host = new URL(pageUrl).hostname;
  if (host.endsWith('monyo.az')) return parseMonyoPage(html, pageUrl);
  if (host.endsWith('clopos.menu')) return parseCloposPage(html);
  const products = pageProducts(html, pageUrl);
  if (products.length === 0) {
    throw new Error(`No menu found on ${host} (Clopos, monyo.az, menu.ps.me, or a site with schema.org Product data)`);
  }
  return products.map(p => ({ name: p.name, imageUrl: p.photo }));
}

/** A company's spelling fixes (scripts/configs/<company>.json "rename"), as
 *  [from, to] pairs replaced anywhere in a name. The converter writes the fixed
 *  names, so the picture script fixes the page's names the same way before matching. */
export function applyRenames(name: string, renames: [string, string][] = []): string {
  return renames.reduce((n, [from, to]) => (from ? n.split(from).join(to) : n), name);
}

/** Pairs our products with the page's pictures by name. A product that
 *  already has a picture keeps it unless `replace`, so running twice does
 *  not upload everything again. */
export function matchPictures(
  products: OurProduct[],
  page: PagePicture[],
  opts: { replace?: boolean } = {},
): PictureMatch {
  const byKey = new Map(page.map(p => [pictureKey(p.name), p]));
  const result: PictureMatch = { matched: [], noPicture: [], notOnPage: [], kept: [] };
  for (const p of products) {
    const found = byKey.get(pictureKey(p.name));
    if (!found) result.notOnPage.push(p.name);
    else if (!found.imageUrl) result.noPicture.push(p.name);
    else if (p.image && !opts.replace) result.kept.push(p.name);
    else result.matched.push({ id: p.id, name: p.name, imageUrl: found.imageUrl });
  }
  return result;
}

/** Where a company's menu picture goes in the menu-images bucket — the same
 *  shape as imagePath('menu', …) in lib/store.ts, so admin's clean-up and the
 *  per-company storage rules treat it like a picture uploaded by hand. */
export function pictureStoragePath(companyId: string, ext: string, now = Date.now(), rand = crypto.randomUUID()): string {
  const clean = ext.replace(/[^\w]/g, '').slice(0, 8) || 'jpg';
  return `${companyId}/${now}-${rand.slice(0, 8)}.${clean}`;
}

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
  const origin = new URL(pageUrl).origin;
  const seen = new Set<string>();
  const out: PagePicture[] = [];
  for (const card of html.split('class="product-card').slice(1)) {
    const name = /class="product-name">([\s\S]*?)<\/h3>/.exec(card)?.[1];
    if (!name) continue;
    const clean = decodeHtml(name).replace(/\s+/g, ' ').trim();
    const key = pictureKey(clean);
    if (seen.has(key)) continue;
    seen.add(key);
    const src = /<img[^>]*?src="([^"]+)"[^>]*class="product-image"/.exec(card)?.[1];
    out.push({ name: clean, imageUrl: src ? new URL(src.replace(/^\/?/, '/'), origin).href : null });
  }
  return out;
}

export type PsMeProduct = { name: string; category: string; price: number | null; photo: string | null };

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
 *  a Poster menu.ps.me page, or any site with schema.org data. Feeds the converter. */
export function pageProducts(html: string, pageUrl: string): PsMeProduct[] {
  return new URL(pageUrl).hostname === 'menu.ps.me' ? psMeProducts(html) : jsonLdProducts(html, pageUrl);
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

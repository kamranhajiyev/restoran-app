import * as XLSX from 'xlsx';
import { COL } from './excel';
import { psMeProducts } from './menu-images';
import type { MenuTextResult } from './menu-text';

// Another POS's menu export turned into the same file the admin import reads.
// Two exports are known, and the reader is picked from the file itself:
//
//   Clopos  — a "Products" sheet with Type / Name / Price / Category / Cost price.
//             Its GOODS/DISH split is not trusted (pizza came as GOODS, Fanta as
//             DISH), so the Növ comes from the company's config.
//   Poster  — no fixed layout: column numbers and how sizes are written live in
//             the company's config. Sometimes dishes and products are two files.
//
// A Poster online menu page (menu.ps.me) works too, with no export at all:
// convertPsMePage reads names, categories and prices off the page.
//
// One config per company in scripts/configs/<company>.json.

export type Source = 'clopos' | 'poster' | 'psme';
type Kind = 'meal' | 'product' | 'set';

interface PosterSheet {
  sheet?: number | string;
  headerRows?: number;
  columns: { name: number; category: number; price: number };
}

export interface ConvertConfig {
  name: string;
  /** Növ by category or name; names are matched by "contains". Case does not matter. */
  setCategories?: string[];
  productCategories?: string[];
  productNames?: string[];
  defaultKind?: 'meal' | 'product';
  // Poster only
  sheet?: number | string;
  headerRows?: number;
  columns?: PosterSheet['columns'];
  dishes?: PosterSheet;
  products?: PosterSheet;
  variantDetection?: 'byEmptyCategory' | 'byName';
  variantLabels?: string[];
  categoryFallthrough?: boolean;
  skipIfNoPrice?: boolean;
}

interface Item {
  category: string;
  name: string;
  price: number | null;
  cost: number | null;
  kind: Kind;
  variants: { name: string; price: number }[];
}

export interface ConvertResult extends MenuTextResult {
  source: Source;
  skipped: string[]; // names left out for having no price
  notes: string[];   // what the file had that the import cannot take
}

// 'İ'.toLowerCase() is 'i' plus a combining dot, so "Soyuq İçkilər" never
// matched "soyuq içkilər". Azerbaijani rules give the plain letter.
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('az');

function parsePrice(val: unknown): number | null {
  if (val === '' || val === null || val === undefined) return null;
  const n = parseFloat(String(val).replace(',', '.').replace(/[₼\s]/g, ''));
  return isNaN(n) || n < 0 ? null : Math.round(n * 100) / 100;
}

function kindRule(cfg: ConvertConfig) {
  const sets = new Set((cfg.setCategories ?? []).map(norm));
  const products = new Set((cfg.productCategories ?? []).map(norm));
  const names = (cfg.productNames ?? []).map(norm);
  return (category: string, name: string, fixed?: 'meal' | 'product'): Kind => {
    if (sets.has(norm(category))) return 'set';
    if (fixed) return fixed;
    if (products.has(norm(category)) || names.some(n => norm(name).includes(n))) return 'product';
    return cfg.defaultKind ?? 'meal';
  };
}

const rowsOf = (sheet: XLSX.WorkSheet) => XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });

export function detectSource(wb: XLSX.WorkBook): Source {
  const sheet = wb.Sheets['Products'];
  const header = sheet ? (rowsOf(sheet)[0] ?? []).map(String) : [];
  return ['Type', 'Name', 'Price', 'Category'].every(h => header.includes(h)) ? 'clopos' : 'poster';
}

function cloposItems(wb: XLSX.WorkBook, cfg: ConvertConfig, notes: string[]): Item[] {
  const kindOf = kindRule(cfg);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Products'], { defval: '' });
  const mods = wb.Sheets['Modificators'] ? rowsOf(wb.Sheets['Modificators']).length - 1 : 0;
  if (mods > 0) notes.push(`${mods} modifier rows in the Modificators sheet are not imported; add them in admin.`);
  return rows
    .map(r => {
      const name = String(r['Name'] ?? '').trim().replace(/\s+/g, ' ');
      const category = String(r['Category'] ?? '').trim();
      const cost = parsePrice(r['Cost price']);
      return { category, name, price: parsePrice(r['Price']), cost: cost || null, kind: kindOf(category, name), variants: [] };
    })
    .filter(i => i.name);
}

function posterItems(wb: XLSX.WorkBook, src: PosterSheet, cfg: ConvertConfig, fixed?: 'meal' | 'product'): Item[] {
  const kindOf = kindRule(cfg);
  const sheetName = typeof src.sheet === 'number' ? wb.SheetNames[src.sheet] : (src.sheet ?? wb.SheetNames[0]);
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error(`Sheet not found. Available: ${wb.SheetNames.join(', ')}`);
  const labels = new Set((cfg.variantLabels ?? []).map(norm));
  const isVariant = (name: string, cat: string) =>
    cfg.variantDetection === 'byName' ? labels.has(norm(name)) : cat === '' && name !== '';

  const items: Item[] = [];
  let lastCategory = '';
  let current: Item | null = null;
  for (const row of rowsOf(sheet).slice(src.headerRows ?? 0)) {
    const name = String(row[src.columns.name] ?? '').trim();
    const cat = String(row[src.columns.category] ?? '').trim();
    const price = parsePrice(row[src.columns.price]);
    if (!name) continue;
    if (cat && cfg.categoryFallthrough !== false) lastCategory = cat;

    if (isVariant(name, cat)) {
      if (current && price !== null) current.variants.push({ name, price });
      continue; // a size with no dish above it is dropped
    }
    if (current) items.push(current);
    const category = cat || lastCategory;
    current = { category, name, price, cost: null, kind: kindOf(category, name, fixed), variants: [] };
  }
  if (current) items.push(current);
  return items;
}

/** `products` is Poster's second file, when it splits dishes and products. */
export function convertMenu(wb: XLSX.WorkBook, cfg: ConvertConfig, products?: XLSX.WorkBook): ConvertResult {
  const source = detectSource(wb);
  const notes: string[] = [];
  let items: Item[];
  if (source === 'clopos') {
    items = cloposItems(wb, cfg, notes);
  } else if (cfg.dishes) {
    // Poster split the export itself, so the file says the Növ.
    items = [
      ...posterItems(wb, cfg.dishes, cfg, 'meal'),
      ...(products && cfg.products ? posterItems(products, cfg.products, cfg, 'product') : []),
    ];
  } else {
    if (!cfg.columns) throw new Error(`${cfg.name}: the config has no Poster columns`);
    items = posterItems(wb, { sheet: cfg.sheet, headerRows: cfg.headerRows, columns: cfg.columns }, cfg);
  }
  return toResult(items, cfg, source, notes);
}

/** A Poster online menu page (menu.ps.me/<id>) as the import file. */
export function convertPsMePage(html: string, cfg: ConvertConfig): ConvertResult {
  const kindOf = kindRule(cfg);
  const items: Item[] = psMeProducts(html).map(p => ({
    category: p.category, name: p.name, price: p.price, cost: null, kind: kindOf(p.category, p.name), variants: [],
  }));
  if (items.length === 0) throw new Error('No products found on the page. Is it a menu.ps.me/<id> link?');
  return toResult(items, cfg, 'psme', []);
}

function toResult(items: Item[], cfg: ConvertConfig, source: Source, notes: string[]): ConvertResult {
  const skipped: string[] = [];
  const rows: MenuTextResult['rows'] = [];
  const categories: string[] = [];
  for (const it of items) {
    const price = it.price ?? it.variants[0]?.price ?? null;
    if (price === null && cfg.skipIfNoPrice) { skipped.push(it.name); continue; }
    if (it.category && !categories.includes(it.category)) categories.push(it.category);
    rows.push({
      [COL.category]: it.category,
      [COL.name]: it.name,
      [COL.price]: price ?? '',
      [COL.cost]: it.cost ?? '',
      [COL.available]: 'Bəli',
      [COL.kind]: it.kind === 'set' ? 'Set' : it.kind === 'product' ? 'Məhsul' : 'Yemək',
      [COL.variants]: it.variants.map(v => `${v.name}=${v.price}`).join(' | '),
    });
  }
  const sets = rows.filter(r => r[COL.kind] === 'Set').length;
  if (sets) notes.push(`${sets} sets come in without their parts; pick the parts in admin.`);
  return { source, rows, categories, errors: [], skipped, notes };
}

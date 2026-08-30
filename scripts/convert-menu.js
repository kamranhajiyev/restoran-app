#!/usr/bin/env node
'use strict';

/**
 * Converts raw restaurant Excel menu export(s) into the app's standard import format.
 *
 * Usage:
 *   node scripts/convert-menu.js --company luna --file /path/to/menu.xlsx
 *
 *   // Poster sometimes exports dishes and products as two separate files —
 *   // pass both and they're merged into one output, kind set from the source file:
 *   node scripts/convert-menu.js --company zarif --file /path/to/dishes.xlsx --products /path/to/products.xlsx
 *
 * Output: <dishes-file-name>-converted.xlsx  (same directory as --file)
 *
 * One config file per company lives in scripts/configs/<company>.json.
 * See configs/luna.json (single-file, kind inferred by category) and
 * configs/zarif.json (two-file, kind fixed per source) for documented examples.
 */

const XLSX = require('xlsx');
const fs   = require('fs');
const path = require('path');

// ── CLI ───────────────────────────────────────────────────────────────────────

const args   = process.argv.slice(2);
const getArg = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] ?? null : null; };

const company     = getArg('--company');
const dishesFile   = getArg('--file');
const productsFile = getArg('--products');

if (!company || !dishesFile) {
  console.error('Usage: node scripts/convert-menu.js --company <name> --file <path> [--products <path>]');
  process.exit(1);
}

for (const f of [dishesFile, productsFile].filter(Boolean)) {
  if (!fs.existsSync(f)) {
    console.error(`File not found: ${f}`);
    process.exit(1);
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

const configPath = path.join(__dirname, 'configs', `${company}.json`);
if (!fs.existsSync(configPath)) {
  console.error(`Config not found: ${configPath}`);
  console.error(`Create scripts/configs/${company}.json — see luna.json or zarif.json for an example.`);
  process.exit(1);
}

/** @type {{
 *   name: string,
 *   sheet?: number | string,
 *   headerRows?: number,
 *   columns?: { name: number, category: number, price: number },
 *   dishes?: { sheet?: number | string, headerRows?: number, columns: { name: number, category: number, price: number } },
 *   products?: { sheet?: number | string, headerRows?: number, columns: { name: number, category: number, price: number } },
 *   variantDetection: 'byEmptyCategory' | 'byName',
 *   variantLabels?: string[],
 *   categoryFallthrough: boolean,
 *   skipIfNoPrice: boolean,
 *   defaultKind?: 'meal' | 'product',
 *   productCategories?: string[],
 * }} */
const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const twoSourceMode = !!cfg.dishes;

// Single-source mode: Poster's export has no meal/product distinction, so it's
// inferred from category — most of a menu is cooked food (meal); drinks and other
// resale-as-is items are listed per-company in productCategories (see luna.json).
// Two-source mode: Poster split the export itself (dishes vs products file), so the
// kind is just fixed per source — no guessing (see zarif.json).
const defaultKind = cfg.defaultKind ?? 'meal';
const productCategorySet = new Set(
  (cfg.productCategories ?? []).map(c => c.trim().toLowerCase())
);

function kindFor(category) {
  return productCategorySet.has(category.trim().toLowerCase()) ? 'product' : defaultKind;
}

const variantSet = new Set(
  (cfg.variantLabels ?? []).map(v => v.trim().toLowerCase())
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function parsePrice(val) {
  if (val === '' || val === null || val === undefined) return null;
  const n = parseFloat(String(val).replace(',', '.').replace(/[₼\s]/g, ''));
  return isNaN(n) || n < 0 ? null : Math.round(n * 100) / 100;
}

function isVariant(rawName, rawCategory) {
  if (cfg.variantDetection === 'byName') {
    return variantSet.has(rawName.trim().toLowerCase());
  }
  // default: byEmptyCategory
  return rawCategory.trim() === '' && rawName.trim() !== '';
}

function serializeVariants(variants) {
  return variants.map(v => `${v.name}=${v.price}`).join(' | ');
}

// ── Parse one source file into items ───────────────────────────────────────────

/** @returns {{ name: string, category: string, price: number|null, variants: {name:string,price:number}[] }[]} */
function parseSource(filePath, sourceCfg) {
  const wb        = XLSX.readFile(filePath);
  const sheetName = typeof sourceCfg.sheet === 'number' ? wb.SheetNames[sourceCfg.sheet] : (sourceCfg.sheet ?? wb.SheetNames[0]);
  const sheet     = wb.Sheets[sheetName];

  if (!sheet) {
    console.error(`Sheet not found in ${filePath}. Available: ${wb.SheetNames.join(', ')}`);
    process.exit(1);
  }

  const colName  = sourceCfg.columns.name;
  const colCat   = sourceCfg.columns.category;
  const colPrice = sourceCfg.columns.price;

  /** @type {unknown[][]} */
  const allRows  = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const dataRows = allRows.slice(sourceCfg.headerRows ?? 0);

  const items = [];
  let lastCategory = '';
  let current      = null;

  for (const row of dataRows) {
    const rawName  = String(row[colName]  ?? '').trim();
    const rawCat   = String(row[colCat]   ?? '').trim();
    const rawPrice = row[colPrice];

    if (!rawName) continue;

    if (rawCat && cfg.categoryFallthrough !== false) lastCategory = rawCat;

    if (isVariant(rawName, rawCat)) {
      if (!current) continue; // orphan variant — skip
      const price = parsePrice(rawPrice);
      if (price !== null) current.variants.push({ name: rawName, price });
    } else {
      if (current) items.push(current);
      const category = rawCat || lastCategory;
      const price    = parsePrice(rawPrice);
      current = { name: rawName, category, price, variants: [] };
    }
  }
  if (current) items.push(current);

  return items;
}

const sourceItems = twoSourceMode
  ? [
      ...parseSource(dishesFile, cfg.dishes).map(item => ({ ...item, kind: 'meal' })),
      ...(productsFile ? parseSource(productsFile, cfg.products).map(item => ({ ...item, kind: 'product' })) : []),
    ]
  : parseSource(dishesFile, { sheet: cfg.sheet, headerRows: cfg.headerRows, columns: cfg.columns })
      .map(item => ({ ...item, kind: kindFor(item.category) }));

// ── Build output rows ─────────────────────────────────────────────────────────

const skipped   = [];
const outputRows = [];

for (const item of sourceItems) {
  const hasVariants = item.variants.length > 0;
  const effectivePrice = item.price ?? (hasVariants ? item.variants[0].price : null);

  if (effectivePrice === null && cfg.skipIfNoPrice) {
    skipped.push(item.name);
    continue;
  }

  outputRows.push({
    'Kateqoriya':      item.category,
    'Məhsul':          item.name,
    'Qiymət (₼)':     effectivePrice ?? '',
    'Maya dəyəri (₼)': '',
    'Mövcud':          'Bəli',
    'Növ':             item.kind === 'product' ? 'Məhsul' : 'Yemək',
    'Variantlar':      hasVariants ? serializeVariants(item.variants) : '',
  });
}

// ── Write output Excel ────────────────────────────────────────────────────────

const outWb     = XLSX.utils.book_new();
const outSheet  = XLSX.utils.json_to_sheet(outputRows.length ? outputRows : [
  { 'Kateqoriya': '', 'Məhsul': '', 'Qiymət (₼)': '', 'Maya dəyəri (₼)': '', 'Mövcud': '', 'Növ': '', 'Variantlar': '' },
]);
outSheet['!cols'] = [{ wch: 22 }, { wch: 34 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 60 }];
XLSX.utils.book_append_sheet(outWb, outSheet, 'Menyu');

const outPath = path.join(
  path.dirname(dishesFile),
  path.basename(dishesFile, path.extname(dishesFile)) + '-converted.xlsx',
);
XLSX.writeFile(outWb, outPath);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`✓ ${cfg.name} — ${outputRows.length} items written → ${outPath}`);
if (skipped.length) console.log(`  Skipped (no price): ${skipped.join(', ')}`);

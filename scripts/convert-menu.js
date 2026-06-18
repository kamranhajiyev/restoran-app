#!/usr/bin/env node
'use strict';

/**
 * Converts a raw restaurant Excel menu into the app's standard import format.
 *
 * Usage:
 *   node scripts/convert-menu.js --company luna --file /path/to/menu.xlsx
 *
 * Output: <input-name>-converted.xlsx  (same directory as input)
 *
 * One config file per company lives in scripts/configs/<company>.json.
 * See configs/luna.json for a documented example.
 */

const XLSX = require('xlsx');
const fs   = require('fs');
const path = require('path');

// ── CLI ───────────────────────────────────────────────────────────────────────

const args   = process.argv.slice(2);
const getArg = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] ?? null : null; };

const company   = getArg('--company');
const inputFile = getArg('--file');

if (!company || !inputFile) {
  console.error('Usage: node scripts/convert-menu.js --company <name> --file <path>');
  process.exit(1);
}

if (!fs.existsSync(inputFile)) {
  console.error(`File not found: ${inputFile}`);
  process.exit(1);
}

// ── Config ────────────────────────────────────────────────────────────────────

const configPath = path.join(__dirname, 'configs', `${company}.json`);
if (!fs.existsSync(configPath)) {
  console.error(`Config not found: ${configPath}`);
  console.error(`Create scripts/configs/${company}.json — see luna.json for an example.`);
  process.exit(1);
}

/** @type {{
 *   name: string,
 *   sheet: number | string,
 *   headerRows: number,
 *   columns: { name: number, category: number, price: number },
 *   variantDetection: 'byEmptyCategory' | 'byName',
 *   variantLabels?: string[],
 *   categoryFallthrough: boolean,
 *   skipIfNoPrice: boolean,
 * }} */
const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const colName  = cfg.columns.name;
const colCat   = cfg.columns.category;
const colPrice = cfg.columns.price;

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

// ── Parse source sheet ────────────────────────────────────────────────────────

const wb        = XLSX.readFile(inputFile);
const sheetName = typeof cfg.sheet === 'number' ? wb.SheetNames[cfg.sheet] : (cfg.sheet ?? wb.SheetNames[0]);
const sheet     = wb.Sheets[sheetName];

if (!sheet) {
  console.error(`Sheet not found in workbook. Available: ${wb.SheetNames.join(', ')}`);
  process.exit(1);
}

/** @type {unknown[][]} */
const allRows  = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
const dataRows = allRows.slice(cfg.headerRows ?? 0);

// ── Group into items ──────────────────────────────────────────────────────────

const items = [];        // { name, category, price, variants: [{name, price}] }
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

// ── Build output rows ─────────────────────────────────────────────────────────

const skipped   = [];
const outputRows = [];

for (const item of items) {
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
    'Variantlar':      hasVariants ? serializeVariants(item.variants) : '',
  });
}

// ── Write output Excel ────────────────────────────────────────────────────────

const outWb     = XLSX.utils.book_new();
const outSheet  = XLSX.utils.json_to_sheet(outputRows.length ? outputRows : [
  { 'Kateqoriya': '', 'Məhsul': '', 'Qiymət (₼)': '', 'Maya dəyəri (₼)': '', 'Mövcud': '', 'Variantlar': '' },
]);
outSheet['!cols'] = [{ wch: 22 }, { wch: 34 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 60 }];
XLSX.utils.book_append_sheet(outWb, outSheet, 'Menyu');

const outPath = path.join(
  path.dirname(inputFile),
  path.basename(inputFile, path.extname(inputFile)) + '-converted.xlsx',
);
XLSX.writeFile(outWb, outPath);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`✓ ${cfg.name} — ${outputRows.length} items written → ${outPath}`);
if (skipped.length) console.log(`  Skipped (no price): ${skipped.join(', ')}`);

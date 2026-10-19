/**
 * Turns another POS's menu export (Clopos or Poster) into the Excel file the admin import reads.
 *
 * Usage:
 *   npm run convert -- --company sherwood-lounge --file /path/to/products_with_modification.xlsx
 *
 *   // Poster sometimes exports dishes and products as two separate files:
 *   npm run convert -- --company zarif --file /path/to/dishes.xlsx --products /path/to/products.xlsx
 *
 *   // A Poster online menu page instead of a file:
 *   npm run convert -- --company cinar-lounge --url https://menu.ps.me/SWoDd4Ipp8E
 *
 * Output: <file>-converted.xlsx next to --file (for --url: ~/Downloads/<company>-converted.xlsx),
 * checked with the import's own reader first.
 * Which POS the file came from is read from the file. One config per company in
 * scripts/configs/<company>.json; the fields are described in lib/menu-convert.ts.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { parseMenuFile } from '@/lib/excel';
import { convertMenu, convertPsMePage, type ConvertConfig } from '@/lib/menu-convert';
import { menuTextWorkbook } from '@/lib/menu-text';

const args = process.argv.slice(2);
const arg = (flag: string) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] ?? null : null; };

async function main() {
  const company = arg('--company');
  const file = arg('--file');
  const productsFile = arg('--products');
  const pageUrl = arg('--url');
  if (!company || (!file && !pageUrl)) {
    console.error('Usage: npm run convert -- --company <name> (--file <path> [--products <path>] | --url <menu.ps.me link>)');
    process.exit(1);
  }
  for (const f of [file, productsFile]) {
    if (f && !fs.existsSync(f)) { console.error(`File not found: ${f}`); process.exit(1); }
  }
  const configPath = path.join(__dirname, 'configs', `${company}.json`);
  if (!fs.existsSync(configPath)) {
    console.error(`Config not found: ${configPath}\nCopy sherwood-lounge.json (Clopos) or luna.json / zarif.json (Poster).`);
    process.exit(1);
  }
  const cfg: ConvertConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  let result;
  if (pageUrl) {
    if (new URL(pageUrl).hostname !== 'menu.ps.me') { console.error('--url takes a menu.ps.me link only.'); process.exit(1); }
    const res = await fetch(pageUrl);
    if (!res.ok) { console.error(`Menu page answered ${res.status}.`); process.exit(1); }
    result = convertPsMePage(await res.text(), cfg);
  } else {
    result = convertMenu(XLSX.readFile(file!), cfg, productsFile ? XLSX.readFile(productsFile) : undefined);
  }
  const buf: Buffer = XLSX.write(menuTextWorkbook(result), { type: 'buffer', bookType: 'xlsx' });

  // The same reader the admin page uses: what it reports here is what the owner would see.
  const preview = await parseMenuFile(new File([new Uint8Array(buf)], 'menu.xlsx'), [], []);
  if (preview.errors.length) { console.error(preview.errors.join('\n')); process.exit(1); }

  const output = file
    ? path.join(path.dirname(file), path.basename(file, path.extname(file)) + '-converted.xlsx')
    : path.join(os.homedir(), 'Downloads', `${company}-converted.xlsx`);
  fs.writeFileSync(output, buf);

  const count = (k: string) => result.rows.filter(r => r['Növ'] === k).length;
  console.log(`✓ ${cfg.name} (${result.source}) — ${preview.newItems.length} items, ${preview.newCategories.length} categories → ${output}`);
  console.log(`  Yemək ${count('Yemək')}, Məhsul ${count('Məhsul')}, Set ${count('Set')}`);
  if (result.skipped.length) console.log(`  Skipped (no price): ${result.skipped.join(', ')}`);
  for (const n of result.notes) console.log(`  ${n}`);
}

main();

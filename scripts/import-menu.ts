/**
 * Puts a converted menu file into a company that has no menu yet, the same
 * rows the admin import writes. For when nobody has the restaurant's login.
 *
 * Usage:
 *   // 1. Look first: reads the file and checks the company is empty
 *   npm run import-menu -- --company chinar-restaurant-lounge --file ~/Downloads/Yeməklər-converted.xlsx
 *
 *   // 2. Then write it
 *   npm run import-menu -- --company <same> --file <same> --write
 *
 * The file is the output of npm run convert (or any file the admin import reads).
 * A company that already has products or categories is refused; use the admin import.
 *
 * The database is the one in .env.local (testing). Production is refused
 * unless --production is given, and only on the owner's say-so (AGENTS.md):
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run import-menu -- … --write --production
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { parseMenuFile } from '@/lib/excel';
import { importBlocked, menuImportRows } from '@/lib/menu-import';

const LIVE_REF = 'laxeqbztathmxfbkkthb';

const args = process.argv.slice(2);
const arg = (flag: string) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] ?? null : null; };
const has = (flag: string) => args.includes(flag);

function fail(msg: string): never { console.error(msg); process.exit(1); }

async function main() {
  const slug = arg('--company');
  const file = arg('--file');
  const write = has('--write');
  if (!slug || !file) fail('Usage: npm run import-menu -- --company <slug> --file <menu.xlsx> [--write] [--production]');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed (.env.local).');
  const live = url.includes(LIVE_REF);
  if (live && write && !has('--production')) fail(`${url} is PRODUCTION. Add --production only when the owner said so for this run.`);
  console.log(`Database: ${url}${live ? '  ← PRODUCTION' : ''}`);
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: company, error: cErr } = await db.from('companies').select('id, name').eq('slug', slug).maybeSingle();
  if (cErr) fail(`Company read failed: ${cErr.message}`);
  if (!company) fail(`No company with slug "${slug}".`);

  // A failed count must stop here, not look like an empty company.
  const [items, cats] = await Promise.all([
    db.from('menu_items').select('id', { count: 'exact', head: true }).eq('company_id', company.id),
    db.from('categories').select('id', { count: 'exact', head: true }).eq('company_id', company.id),
  ]);
  if (items.error || cats.error || items.count === null || cats.count === null) {
    fail(`Menu read failed: ${(items.error ?? cats.error)?.message}`);
  }
  const blocked = importBlocked({ items: items.count, categories: cats.count });
  if (blocked) fail(`${company.name}: ${blocked}`);

  const buf = fs.readFileSync(file);
  const preview = await parseMenuFile(new File([buf], path.basename(file)), [], []);
  const { categories, items: rows } = menuImportRows(preview, company.id);
  const kinds = rows.reduce<Record<string, number>>((n, r) => ({ ...n, [r.kind]: (n[r.kind] ?? 0) + 1 }), {});
  console.log(`${company.name}: file has ${preview.totalRows} rows → ${rows.length} products, ${categories.length} categories`);
  console.log(`  ${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  if (preview.errors.length) {
    preview.errors.forEach(e => console.log(`  ! ${e}`));
    fail('Fix the file first; nothing was written.');
  }
  if (!write) { console.log('Nothing written. Run again with --write.'); return; }

  const { error: catErr } = await db.from('categories').insert(categories);
  if (catErr) fail(`Categories failed: ${catErr.message}`);
  const { error: itemErr } = await db.from('menu_items').insert(rows);
  if (itemErr) {
    // Categories without their products would block the next try (not empty).
    await db.from('categories').delete().eq('company_id', company.id);
    fail(`Products failed: ${itemErr.message} (categories taken back out)`);
  }
  console.log(`Written: ${categories.length} categories, ${rows.length} products.`);
}

main().catch(e => fail(String(e)));

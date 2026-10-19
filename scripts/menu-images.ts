/**
 * Gives an imported menu the pictures from the restaurant's online menu.
 *
 * Usage:
 *   // 1. Look first: matches by name and downloads to ~/Desktop/<company>-pictures
 *   npm run menu-images -- --company meydan-test --url https://sherewoodlounge.clopos.menu/az/1/products
 *
 *   // 2. Then upload and link them to the products
 *   npm run menu-images -- --company meydan-test --url <same> --upload
 *
 *   // A monyo.az menu works the same way
 *   npm run menu-images -- --company cinar --url "https://monyo.az/v4/?r=cinarrestoran"
 *
 * --company is the company's slug. A product that already has a picture keeps
 * it unless --replace is given, so a second run uploads nothing twice.
 *
 * The database is the one in .env.local (testing). Production is refused
 * unless --production is given, and only on the owner's say-so (AGENTS.md):
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run menu-images -- … --upload --production
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { matchPictures, parseMenuPage, pictureStoragePath } from '@/lib/menu-images';

const LIVE_REF = 'laxeqbztathmxfbkkthb';
const BUCKET = 'menu-images';

const args = process.argv.slice(2);
const arg = (flag: string) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] ?? null : null; };
const has = (flag: string) => args.includes(flag);

function fail(msg: string): never { console.error(msg); process.exit(1); }

async function main() {
  const slug = arg('--company');
  const pageUrl = arg('--url');
  const upload = has('--upload');
  if (!slug || !pageUrl) fail('Usage: npm run menu-images -- --company <slug> --url <menu page> [--upload] [--replace] [--production]');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed (.env.local).');
  const live = url.includes(LIVE_REF);
  if (live && upload && !has('--production')) fail(`${url} is PRODUCTION. Add --production only when the owner said so for this run.`);
  console.log(`Database: ${url}${live ? '  ← PRODUCTION' : ''}`);
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: company, error: cErr } = await db.from('companies').select('id, name').eq('slug', slug).maybeSingle();
  if (cErr) fail(`Company read failed: ${cErr.message}`);
  if (!company) fail(`No company with slug "${slug}".`);

  // A failed read must stop here, not look like an empty menu.
  const { data: products, error: pErr } = await db
    .from('menu_items').select('id, name, image').eq('company_id', company.id);
  if (pErr || !products) fail(`Menu read failed: ${pErr?.message}`);

  const res = await fetch(pageUrl);
  if (!res.ok) fail(`Menu page answered ${res.status}.`);
  const page = parseMenuPage(await res.text(), pageUrl);
  if (page.length === 0) fail('No products found on the page. Is it a Clopos …/products or monyo.az/v4/?r=… page?');

  const m = matchPictures(products, page, { replace: has('--replace') });
  console.log(`${company.name}: ${products.length} products, page has ${page.length}.`);
  console.log(`  get a picture:      ${m.matched.length}`);
  if (m.kept.length) console.log(`  already have one:   ${m.kept.length} (kept; --replace to change)`);
  if (m.noPicture.length) console.log(`  page has no picture: ${m.noPicture.join(', ')}`);
  if (m.notOnPage.length) console.log(`  not on the page:    ${m.notOnPage.join(', ')}`);
  if (m.matched.length === 0) return;

  const dir = path.join(os.homedir(), 'Desktop', `${slug}-pictures`);
  fs.mkdirSync(dir, { recursive: true });
  let uploaded = 0;
  const failed: string[] = [];
  for (const item of m.matched) {
    const pic = await fetch(item.imageUrl);
    if (!pic.ok) { failed.push(`${item.name} (download ${pic.status})`); continue; }
    const body = Buffer.from(await pic.arrayBuffer());
    const type = pic.headers.get('content-type') ?? 'image/jpeg';
    const ext = path.extname(new URL(item.imageUrl).pathname).slice(1) || 'jpg';
    fs.writeFileSync(path.join(dir, `${item.name.trim().replace(/[/\\:]/g, '-')}.${ext}`), body);
    if (!upload) continue;

    const storagePath = pictureStoragePath(company.id, ext);
    const up = await db.storage.from(BUCKET).upload(storagePath, body, { contentType: type });
    if (up.error) { failed.push(`${item.name} (upload: ${up.error.message})`); continue; }
    const publicUrl = db.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
    const { error } = await db.from('menu_items')
      .update({ image: publicUrl }).eq('id', item.id).eq('company_id', company.id);
    if (error) {
      // No product points at the file, so it would only take up space.
      await db.storage.from(BUCKET).remove([storagePath]);
      failed.push(`${item.name} (link: ${error.message})`);
      continue;
    }
    uploaded++;
  }

  console.log(`Downloaded to ${dir}`);
  if (upload) console.log(`Uploaded and linked: ${uploaded} of ${m.matched.length}`);
  else console.log('Nothing uploaded. Check the folder, then run again with --upload.');
  if (failed.length) { console.log(`Failed: ${failed.join('; ')}`); process.exitCode = 1; }
}

main().catch(e => fail(String(e)));

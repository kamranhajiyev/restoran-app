/**
 * Shrinks the menu pictures already in storage, once, to the size new uploads
 * get (lib/shrink-picture.ts). Each file keeps its name and format, so no link
 * in the database changes. Logos are left alone.
 *
 * Usage:
 *   // 1. Look first: lists what would shrink and by how much
 *   npm run shrink-pictures
 *
 *   // 2. Then write. The originals are saved to ~/Desktop/Possiblle/Backups first.
 *   npm run shrink-pictures -- --apply
 *
 * The database is the one in .env.local (testing). Production is refused
 * unless --production is given, and only on the owner's say-so (AGENTS.md).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { PICTURE_CACHE } from '@/lib/shrink-picture';
import { formatOf, shrinkPictureBuffer } from '@/lib/shrink-picture-node';

const LIVE_REF = 'laxeqbztathmxfbkkthb';
const BUCKET = 'menu-images';

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);

function fail(msg: string): never { console.error(msg); process.exit(1); }

const kb = (n: number) => `${Math.round(n / 1024)} KB`;

async function main() {
  const apply = has('--apply');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed (.env.local).');
  const live = url.includes(LIVE_REF);
  if (live && apply && !has('--production')) fail(`${url} is PRODUCTION. Add --production only when the owner said so for this run.`);
  console.log(`Database: ${url}${live ? '  ← PRODUCTION' : ''}`);
  const db = createClient(url, key, { auth: { persistSession: false } });

  // Every file in the bucket except logos. A failed listing stops the run.
  const files: string[] = [];
  async function walk(prefix: string) {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db.storage.from(BUCKET).list(prefix, { limit: 1000, offset });
      if (error || !data) fail(`Listing ${prefix || '/'} failed: ${error?.message}`);
      for (const entry of data) {
        const full = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.id === null) { if (entry.name !== 'logos') await walk(full); }
        else if (formatOf(entry.name)) files.push(full);
      }
      if (data.length < 1000) return;
    }
  }
  await walk('');

  const backup = path.join(os.homedir(), 'Desktop', 'Possiblle', 'Backups',
    `menu-pictures-${new Date().toISOString().slice(0, 10)}${live ? '-production' : '-testing'}`);
  let before = 0, after = 0, shrunk = 0;
  const failed: string[] = [];
  for (const file of files) {
    const { data, error } = await db.storage.from(BUCKET).download(file);
    if (error || !data) { failed.push(`${file} (download: ${error?.message})`); continue; }
    const body = Buffer.from(await data.arrayBuffer());
    const small = await shrinkPictureBuffer(body, formatOf(file)!).catch(() => null);
    if (!small) continue;
    before += body.length;
    after += small.body.length;
    shrunk++;
    console.log(`  ${file}: ${kb(body.length)} → ${kb(small.body.length)}`);
    if (!apply) continue;

    // Production has no backups: the original is on this Mac before it is replaced.
    const keep = path.join(backup, file);
    fs.mkdirSync(path.dirname(keep), { recursive: true });
    fs.writeFileSync(keep, body);
    const up = await db.storage.from(BUCKET).upload(file, small.body,
      { contentType: small.type, cacheControl: PICTURE_CACHE, upsert: true });
    if (up.error) failed.push(`${file} (upload: ${up.error.message})`);
  }

  console.log(`${files.length} pictures, ${shrunk} to shrink: ${kb(before)} → ${kb(after)}.`);
  if (apply && shrunk) console.log(`Originals saved to ${backup}`);
  if (!apply) console.log('Nothing written. Run again with --apply.');
  if (failed.length) { console.log(`Failed: ${failed.join('; ')}`); process.exitCode = 1; }
}

main().catch(e => fail(String(e)));

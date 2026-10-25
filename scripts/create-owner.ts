/**
 * Makes the owner login for a new company, for when superadmin is not at hand.
 *
 * Usage:
 *   npm run create-owner -- --company odessa-doner --username odessadoner --password Odessa1234
 *
 * A company that already has an owner is refused. The database is the one in
 * .env.local (testing). Production is refused unless --production is given, and
 * only on the owner's say-so (AGENTS.md):
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run create-owner -- … --production
 */
import { createClient } from '@supabase/supabase-js';
import { createOwner } from '@/lib/create-owner';

const LIVE_REF = 'laxeqbztathmxfbkkthb';

const args = process.argv.slice(2);
const arg = (flag: string) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] ?? null : null; };

function fail(msg: string): never { console.error(msg); process.exit(1); }

async function main() {
  const slug = arg('--company');
  const username = arg('--username');
  const password = arg('--password');
  if (!slug || !username || !password) fail('Usage: npm run create-owner -- --company <slug> --username <name> --password <password> [--production]');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed (.env.local).');
  const live = url.includes(LIVE_REF);
  if (live && !args.includes('--production')) fail(`${url} is PRODUCTION. Add --production only when the owner said so for this run.`);
  console.log(`Database: ${url}${live ? '  ← PRODUCTION' : ''}`);

  const db = createClient(url, key, { auth: { persistSession: false } });
  const result = await createOwner(db, { slug, username, password });
  if ('error' in result) fail(result.error);
  console.log(`✓ ${result.companyName}: owner login "${username}" created`);
}

main().catch(e => fail(String(e)));

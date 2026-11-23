// Which Supabase an exe or APK is exported with, from the site it syncs with.
//
// The till's page talks to Supabase directly for its live signals
// (lib/till-signal.ts), while everything it saves goes through the site. Both
// must be the same database. A test exe synced with the preview site (the
// "restoran testing" database) but was exported with production's address, so
// it listened on production, never heard a new order, and waited for its
// 3-minute timer (Natiq, 2026-11-23).
//
// Blank site or the production site: production, from the build's secrets.
// Any other site (a preview): testing.
//
// Used by .github/workflows/desktop.yml and android.yml:
//   node scripts/pick-database.mjs "<site>" >> "$GITHUB_ENV"
// with PROD_URL and PROD_KEY set from the secrets.

import { fileURLToPath } from 'node:url';

export const PRODUCTION_SITE = 'https://www.possiblle.com';

// The "restoran testing" project. The anon key is the public one that every
// browser on the testing site already has, so it is safe in the repository.
export const TESTING = {
  url: 'https://bmqilobhdbipnpkyzomb.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJtcWlsb2JoZGJpcG5wa3l6b21iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2MzQxOTIsImV4cCI6MjA5ODIxMDE5Mn0.AvTIYollAJgRjijrG3yhovDontKzORKf7cWVDeKnaFo',
};

/** True when a build for this site belongs to production. */
export function isProductionSite(site) {
  const s = (site ?? '').trim().replace(/\/+$/, '').toLowerCase();
  return s === '' || s === PRODUCTION_SITE || s === 'https://possiblle.com';
}

/** The two public values to export the till with. */
export function pickDatabase(site, prod) {
  if (isProductionSite(site)) {
    if (!prod?.url || !prod?.key) throw new Error('production build without NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY secrets');
    return { url: prod.url, key: prod.key, which: 'production' };
  }
  return { url: TESTING.url, key: TESTING.key, which: 'testing' };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const site = process.argv[2] ?? '';
  const db = pickDatabase(site, { url: process.env.PROD_URL, key: process.env.PROD_KEY });
  console.error(`[pick-database] site "${site || PRODUCTION_SITE}" → ${db.which} (${db.url})`);
  process.stdout.write(`NEXT_PUBLIC_SUPABASE_URL=${db.url}\nNEXT_PUBLIC_SUPABASE_ANON_KEY=${db.key}\n`);
}

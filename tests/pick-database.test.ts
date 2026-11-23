// A test exe or APK must listen on the database it saves to. One exported with
// production's address but synced with the preview site never heard a new order
// and waited for its 3-minute timer (Natiq, 2026-11-23).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error plain .mjs build script, no types
import { pickDatabase, isProductionSite, TESTING } from '../scripts/pick-database.mjs';

const PROD = { url: 'https://laxeqbztathmxfbkkthb.supabase.co', key: 'prod-key' };
const PREVIEW = 'https://restoran-app-git-developmen-f968e3-abdulla-bashiroglus-projects.vercel.app';

describe('the database a till is exported with', () => {
  it('a production build (blank site or possiblle.com) gets production', () => {
    for (const site of ['', '  ', 'https://www.possiblle.com', 'https://www.possiblle.com/', 'https://possiblle.com']) {
      expect(isProductionSite(site)).toBe(true);
      expect(pickDatabase(site, PROD).url).toBe(PROD.url);
    }
  });

  it('a build for the preview site gets testing, never production', () => {
    const db = pickDatabase(PREVIEW, PROD);
    expect(db.url).toBe('https://bmqilobhdbipnpkyzomb.supabase.co');
    expect(db.url).not.toBe(PROD.url);
  });

  it('the testing key is the public anon key of the testing project', () => {
    const payload = JSON.parse(Buffer.from(TESTING.key.split('.')[1], 'base64url').toString());
    expect(payload).toMatchObject({ ref: 'bmqilobhdbipnpkyzomb', role: 'anon' });
  });

  it('a production build without the secrets stops instead of shipping a broken till', () => {
    expect(() => pickDatabase('', { url: '', key: '' })).toThrow();
  });

  it('both workflows export the till through pick-database, not straight from the secrets', () => {
    for (const file of ['.github/workflows/desktop.yml', '.github/workflows/android.yml']) {
      const yml = readFileSync(file, 'utf8');
      expect(yml).toContain('node scripts/pick-database.mjs');
      expect(yml).not.toMatch(/^\s*NEXT_PUBLIC_SUPABASE_URL:\s*\$\{\{\s*secrets\./m);
    }
  });
});

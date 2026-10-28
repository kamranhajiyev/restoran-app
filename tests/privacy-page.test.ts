// The privacy policy at /privacy is what Google Play links to. It promises
// what the app does not take; if the Android app ever asks for one of those,
// the page (and the Play Data safety form) must change with it.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('app/privacy/page.tsx', 'utf8');

describe('the privacy page', () => {
  it('is public, in the sitemap and the footer', () => {
    expect(readFileSync('app/sitemap.ts', 'utf8')).toMatch(/\$\{SITE_URL\}\/privacy/);
    expect(readFileSync('components/marketing/SiteFooter.tsx', 'utf8')).toMatch(/href="\/privacy"/);
  });

  it('says how to get data deleted, in both languages', () => {
    expect(page).toMatch(/Məlumatların silinməsi/);
    expect(page).toMatch(/Deleting data/);
    expect(page).toMatch(/wa\.me\/\d+/);
  });

  it('promises no location, contacts or photos, and the Android app asks for none', () => {
    expect(page).toMatch(/No location, contacts, photos or advertising ID/);
    const manifests = [
      'android/app/src/main/AndroidManifest.xml',
      'android/app/src/direct/AndroidManifest.xml',
    ].map(p => readFileSync(p, 'utf8')).join('\n');
    expect(manifests).not.toMatch(/LOCATION|READ_CONTACTS|CAMERA|READ_MEDIA|READ_EXTERNAL_STORAGE|AD_ID/);
  });
});

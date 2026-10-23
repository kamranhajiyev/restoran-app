// The Android till on a phone with an older Chrome.
//
// 2026-10-22: a phone stuck on Chrome 101 opened the APK to "This page couldn't
// load". The APK runs in the phone's own browser engine, and the page was built
// for Chrome 111. Its copy of the page is now built for ANDROID_CHROME (tested
// on a Chrome 91 emulator: setup, PIN, an order, Tarixçə), and anything older
// gets a screen saying so. The browser and the exe keep the normal build.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ANDROID_BROWSERS, ANDROID_CHROME, oldTransforms, unlayer } from '@/lib/android-browsers.mjs';
import { installPolyfills } from '@/lib/android-polyfills';

const read = (p: string) => readFileSync(p, 'utf8');
const java = (name: string) => read(`android/app/src/main/java/com/possiblle/pos/${name}.java`);

describe('the APK copy of the page', () => {
  it('is built for the oldest Chrome the app lets in, and only for the APK', () => {
    const asks = Number(java('WebViewCheck').match(/MIN_CHROME = (\d+);/)?.[1]);
    expect(asks).toBe(ANDROID_CHROME);
    expect(ANDROID_BROWSERS).toEqual([`chrome ${ANDROID_CHROME}`]);

    expect(read('package.json')).toMatch(/"android:till": "node scripts\/build-desktop\.mjs --android"/);
    expect(read('.github/workflows/android.yml')).toMatch(/run: npm run android:till/);
    expect(read('android/app/build.gradle')).toMatch(/file\('\.\.\/\.\.\/out-android'\)/);
    // The exe brings its own Chrome and keeps the normal build.
    expect(read('.github/workflows/desktop.yml')).not.toMatch(/android:till/);
  });

  it('gives a rewritten stylesheet a new name, or a phone keeps the cached old one', () => {
    const build = read('scripts/build-desktop.mjs');
    expect(build).toMatch(/createHash\('sha256'\)\.update\(css\)/);
    expect(build).toMatch(/instrumentation-client\.ts/);
  });
});

describe('unlayer', () => {
  it('keeps the rules inside @layer, in order, and drops the order statement', () => {
    const css = '@layer theme,base;@layer theme{:root{--a:1}}@layer base{a{color:red}@media (min-width:1px){b{color:blue}}}.c{x:y}';
    expect(unlayer(css)).toBe(':root{--a:1}a{color:red}@media (min-width:1px){b{color:blue}}.c{x:y}');
  });
});

describe('oldTransforms', () => {
  it('moves and turns with transform, which an old Chrome reads', () => {
    expect(oldTransforms('.a{--tw-translate-y:-50%;translate:var(--tw-translate-x) var(--tw-translate-y)}'))
      .toBe('.a{--tw-translate-y:-50%;transform:translate(var(--tw-translate-x,0),var(--tw-translate-y,0))}');
    expect(oldTransforms('.r{rotate:180deg}')).toBe('.r{transform:rotate(180deg)}');
  });
});

describe('installPolyfills', () => {
  function oldChrome() {
    const g = {
      crypto: { getRandomValues: (a: Uint8Array) => { a.fill(171); return a; } },
      Array: { prototype: {} },
      String: { prototype: {} },
      Object: {},
      Promise: {},
      AbortSignal: {},
    };
    installPolyfills(g as unknown as typeof globalThis);
    return g as unknown as Record<string, Record<string, (...a: never[]) => unknown>> & {
      Array: { prototype: { at: (this: unknown[], i: number) => unknown } };
    };
  }

  it('fills in what Chrome 91 lacks', () => {
    const g = oldChrome();
    expect(g.crypto.randomUUID()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(g.Array.prototype.at.call([1, 2, 3], -1)).toBe(3);
    expect((g.Object.hasOwn as unknown as (o: object, k: string) => boolean)({ a: 1 }, 'a')).toBe(true);
    const groups = (g.Object.groupBy as unknown as (x: number[], k: (n: number) => string) => Record<string, number[]>)(
      [1, 2, 3], n => (n % 2 ? 'odd' : 'even'),
    );
    expect(groups.odd).toEqual([1, 3]);
    expect(typeof g.Promise.withResolvers).toBe('function');
    expect(typeof g.AbortSignal.timeout).toBe('function');
  });

  it('leaves a newer Chrome its own', () => {
    const own = () => 'own';
    const g = { crypto: { randomUUID: own }, Array: { prototype: {} }, String: { prototype: {} }, Object: {}, Promise: {} };
    installPolyfills(g as unknown as typeof globalThis);
    expect(g.crypto.randomUUID).toBe(own);
  });
});

describe('the engine check', () => {
  it('shows the "too old" screen instead of the page below that Chrome', () => {
    const main = java('MainActivity');
    const check = main.indexOf('WebViewCheck.tooOld()');
    expect(check).toBeGreaterThan(-1);
    expect(main.indexOf('web.loadUrl(', check)).toBeGreaterThan(check);
    expect(main).toMatch(/if \(engine != null\)[\s\S]*WebViewCheck\.page\(engine\)[\s\S]*else if \(state != null\)/);
    expect(java('WebViewCheck')).toMatch(/market:\/\/details\?id=" \+ p\.packageName/);
  });
});

describe('the top bar on a phone', () => {
  it('fits the screen: the sync label and the waiter badge only from sm up', () => {
    expect(read('components/SyncStatus.tsx')).toMatch(/<span className=\{below \? 'hidden sm:inline' : undefined\}>\{text\}<\/span>/);
    expect(read('app/seller/page.tsx')).toMatch(/className="hidden sm:flex items-center gap-2 px-3 py-1\.5 bg-stone-50 border border-stone-100 rounded-xl"/);
  });
});

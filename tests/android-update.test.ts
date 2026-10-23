// The Android app updates itself like the exe (android/…/Updater.java): the
// page gets the same posNative.update, so the same "Yeni versiyanı yüklə"
// shows, and it hears again when an install was cancelled.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopUpdate, PosNative } from '@/lib/desktopPrint';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

function android(opts: { updater?: boolean; ready?: DesktopUpdate | null } = {}) {
  const installs: number[] = [];
  const bridge: Record<string, unknown> = { print: () => {}, scan: () => {} };
  if (opts.updater !== false) {
    Object.assign(bridge, {
      hasUpdater: () => true,
      updateStatus: () => JSON.stringify(opts.ready ?? null),
      updateInstall: () => { installs.push(1); },
    });
  }
  const win: Record<string, unknown> = { btoa: (s: string) => s, PosAndroid: bridge };
  vi.stubGlobal('window', win);
  vi.stubGlobal('navigator', {});
  return { win, installs };
}

async function update(win: Record<string, unknown>) {
  await import('@/lib/desktopPrint');
  return (win.posNative as PosNative).update;
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('the Android app update', () => {
  it('says nothing until an APK is downloaded', async () => {
    const u = await update(android().win);
    expect(await u!.status()).toBeNull();
  });

  it('reports a waiting update, which reopens by hand on Android', async () => {
    const ready = { version: '0.5.0', required: true, reopens: false };
    const u = await update(android({ ready }).win);
    expect(await u!.status()).toEqual(ready);
  });

  it('tells the page when a download is ready, and again after a cancelled install', async () => {
    const { win } = android();
    const u = await update(win);
    const heard: DesktopUpdate[] = [];
    const stop = u!.onReady(s => heard.push(s));
    const say = win.__posAndroidUpdate as (s: DesktopUpdate | null) => void;
    say({ version: '0.5.0', required: false, reopens: false });
    say({ version: '0.5.0', required: false, reopens: false });
    stop();
    say({ version: '0.5.0', required: false, reopens: false });
    expect(heard).toHaveLength(2);
  });

  it('hands the install to the app', async () => {
    const { win, installs } = android();
    await (await update(win))!.install();
    expect(installs).toHaveLength(1);
  });

  it('shows no update button in an APK without the updater', async () => {
    expect(await update(android({ updater: false }).win)).toBeUndefined();
  });

  it('lets the button be pressed again once a cancelled install is heard', () => {
    const src = readFileSync('components/DesktopUpdate.tsx', 'utf8');
    expect(src).toMatch(/onReady\(s => \{ setUpdate\(s\); setInstalling\(false\); \}\)/);
  });

  it('attaches a key-signed APK to every release, after the exe', () => {
    const desktop = readFileSync('.github/workflows/desktop.yml', 'utf8');
    expect(desktop).toMatch(/android:\s+needs: build[\s\S]*uses: \.\/\.github\/workflows\/android\.yml[\s\S]*release: true/);
    const apk = readFileSync('.github/workflows/android.yml', 'utf8');
    expect(apk).toMatch(/a release APK must carry the restaurant key/);
    expect(apk).toMatch(/if: inputs\.release[\s\S]*PossibllePOS\.apk/);
  });

  it('builds a key-signed production APK from an apk-* tag, without main', () => {
    const apk = readFileSync('.github/workflows/android.yml', 'utf8');
    expect(apk).toMatch(/push:[\s\S]*tags: \['apk-\*'\]/);
    // setup-android failed every build on GitHub (2026-10-23); the image's own SDK is used.
    expect(apk).toMatch(/runs-on: ubuntu-24\.04/);
    expect(apk).not.toMatch(/setup-android/);
    // The tag takes the production branch of both the key check and the build.
    expect(apk).toMatch(/elif \[ "\$\{\{ inputs\.release \}\}" = "true" \] \|\| \[\[ "\$GITHUB_REF" == refs\/tags\/apk-\* \]\]; then\s+# Every till/);
    expect(apk).toMatch(/if \[ "\$\{\{ inputs\.release \}\}" = "true" \] \|\| \[\[ "\$GITHUB_REF" == refs\/tags\/apk-\* \]\]; then\s+\.\/gradlew assembleRelease\n/);
  });
});

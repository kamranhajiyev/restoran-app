// The Google Play app (android/, "play" flavor). Play bans an app that
// installs its own new version and, since 2026-08-31, takes nothing below
// targetSdk 36 — which draws the app under the status bar and stops calling
// onBackPressed. The APK we hand out ("direct") keeps its updater.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(p, 'utf8');
const gradle = read('android/app/build.gradle');
const activity = read('android/app/src/main/java/com/possiblle/pos/MainActivity.java');

describe('the Google Play app', () => {
  it('has no updater and no install permission; the handed-out APK keeps both', () => {
    expect(gradle).toMatch(/productFlavors \{\s+direct \{[\s\S]*play \{/);
    const main = read('android/app/src/main/AndroidManifest.xml');
    expect(main).not.toMatch(/REQUEST_INSTALL_PACKAGES|Updater\$InstallResult/);
    const direct = read('android/app/src/direct/AndroidManifest.xml');
    expect(direct).toMatch(/REQUEST_INSTALL_PACKAGES/);
    expect(direct).toMatch(/Updater\$InstallResult/);
    expect(read('android/app/src/direct/java/com/possiblle/pos/Updater.java')).toMatch(/PackageInstaller/);
    const play = read('android/app/src/play/java/com/possiblle/pos/Updater.java');
    expect(play).toMatch(/static Updater create\([^)]*\) \{\s+return null;/);
    expect(play).not.toMatch(/PackageInstaller|REQUEST_INSTALL/);
    expect(activity).toMatch(/updater = Updater\.create\(this, web\);\s+if \(updater != null\)/);
  });

  it('targets the Android version Play asks for', () => {
    const target = Number(gradle.match(/targetSdk (\d+)/)![1]);
    expect(target).toBeGreaterThanOrEqual(36);
    expect(Number(gradle.match(/compileSdk (\d+)/)![1])).toBeGreaterThanOrEqual(target);
  });

  it('keeps the page out from under the status bar, the navigation bar and the keyboard', () => {
    expect(activity).toMatch(/setContentView\(belowSystemBars\(web\)\)/);
    expect(activity).toMatch(/WindowInsets\.Type\.systemBars\(\)\s*\|\s*WindowInsets\.Type\.displayCutout\(\) \| WindowInsets\.Type\.ime\(\)/);
    expect(activity).toMatch(/setPadding\(bars\.left, bars\.top, bars\.right, bars\.bottom\)/);
  });

  it('goes back a page on Back, where Android 16 no longer calls onBackPressed', () => {
    expect(activity).toMatch(/registerOnBackInvokedCallback\([\s\S]*?if \(web\.canGoBack\(\)\) web\.goBack\(\);\s+else moveTaskToBack\(true\);/);
  });

  it('builds the .aab only for production, never with a preview url', () => {
    const apk = read('.github/workflows/android.yml');
    const builds = apk.match(/\.\/gradlew [^\n]*/g)!;
    for (const b of builds) {
      expect(b).toMatch(/assembleDirectRelease/);
      if (b.includes('bundlePlayRelease')) expect(b).not.toMatch(/posUrl/);
    }
    expect(builds.some(b => b.includes('bundlePlayRelease'))).toBe(true);
    expect(apk).toMatch(/name: PossibllePOS-play-aab\s+path: android\/app\/build\/out\/PossibllePOS\.aab/);
    // A release build without the till page must stop, the .aab too.
    expect(gradle).toMatch(/it\.name ==~ \/\(assemble\|bundle\)\\w\*Release\//);
  });
});

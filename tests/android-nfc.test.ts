// 2026-11-01: a phone has no USB card reader, only NFC. The Android app reads
// a manager's 13.56 MHz card with it while the approval box waits, and admin
// takes the same card's id in hex, as NFC apps show it.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cardNumber } from '@/lib/card-reader';
import { listenNfc } from '@/lib/android-nfc';

const java = (f: string) => readFileSync(`android/app/src/main/java/com/possiblle/pos/${f}`, 'utf8');

describe("an NFC card's id", () => {
  it('is one number, whether the phone reads it or the owner copies it from an app', () => {
    // 04:A2:3B:1C = 77740828; ten digits or fewer keep their low 24 bits.
    expect(cardNumber('04:A2:3B:1C')).toBe('10631964');
    expect(cardNumber('04:a2:3b:1c')).toBe(cardNumber('04:A2:3B:1C'));
    expect(cardNumber('0077740828')).toBe(cardNumber('04:A2:3B:1C'));
    // A seven-byte id is too long for that and is kept whole, without BigInt.
    expect(cardNumber('04:11:22:33:44:55:66')).toBe('1144738493519206');
  });

  it('is read however an NFC app writes it', () => {
    for (const as of ['04 A2 3B 1C', '04-A2-3B-1C', '04A23B1C', '04a23b1c']) expect(cardNumber(as)).toBe('10631964');
  });

  it('is a plain number when it has no letter and no separators', () => {
    expect(cardNumber('12345678')).toBe('12345678');
    expect(cardNumber('04 A2')).toBeNull();
  });
});

describe('the phone listening', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('turns on while the box waits, hands over each card, and turns off', () => {
    const listen = vi.fn();
    const win: Record<string, unknown> = { PosAndroid: { hasNfc: () => true, nfcListen: listen } };
    vi.stubGlobal('window', win);
    const got: string[] = [];
    const stop = listenNfc(hex => got.push(hex));
    expect(listen).toHaveBeenLastCalledWith(true);
    (win.__posAndroidNfc as (h: string) => void)('04:A2:3B:1C');
    expect(got).toEqual(['04:A2:3B:1C']);
    stop();
    expect(listen).toHaveBeenLastCalledWith(false);
    expect(win.__posAndroidNfc).toBeUndefined();
  });

  it('does nothing in the browser, the exe, an APK before NFC, or a phone with NFC off', () => {
    for (const PosAndroid of [undefined, {}, { hasNfc: () => false, nfcListen: vi.fn() }]) {
      vi.stubGlobal('window', { PosAndroid });
      expect(() => listenNfc(() => {})()).not.toThrow();
    }
  });

  it('is asked for by the approval box only when a card is taken', () => {
    const pad = readFileSync('components/seller/ApprovalPad.tsx', 'utf8');
    expect(pad).toMatch(/if \(!cards\) return;\s+return listenNfc\(/);
  });
});

describe('the Android app', () => {
  it('installs on phones without NFC', () => {
    const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
    expect(manifest).toMatch(/android\.permission\.NFC/);
    expect(manifest).toMatch(/android:name="android\.hardware\.nfc" android:required="false"/);
  });

  it('reads cards only for our page, and only while the app is in front', () => {
    expect(java('PrinterBridge.java')).toMatch(/return trusted && n != null && n\.available\(\);/);
    // A page that leaves mid-approval does not leave NFC on.
    expect(java('PrinterBridge.java')).toMatch(/this\.tillPage = [^\n]+\n(\s+\/\/[^\n]*\n)+\s+NfcCards n = nfc;\s+if \(n != null\) n\.listen\(false\);/);
    expect(java('PrinterBridge.java')).toMatch(/n\.listen\(trusted && on\)/);
    const main = java('MainActivity.java');
    expect(main).toMatch(/onResume\(\) \{\s+super\.onResume\(\);\s+nfc\.resume\(\);/);
    expect(main).toMatch(/onPause\(\) \{\s+nfc\.pause\(\);/);
    expect(java('NfcCards.java')).toMatch(/window\.__posAndroidNfc && window\.__posAndroidNfc\('/);
  });
});

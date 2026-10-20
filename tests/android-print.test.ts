// The Android till (android/): the seller page in a WebView, printing over
// Wi-Fi through the app's PosAndroid object. These check that the page turns
// that object into the exe's posNative, that the receipt goes to the saved
// Wi-Fi IP there, and that the exe's USB receipt printer is left as it was.

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

type Answer =(id: string, error: string | null, result: string | null) => void;

function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
  };
}

/** An Android WebView: PosAndroid, no WebUSB. `fail` makes every print refuse. */
function android(opts: { fail?: string; found?: string[]; typed?: string | null } = {}) {
  const prints: { ip: string; port: number; bytes: number[] }[] = [];
  const win: Record<string, unknown> = {
    btoa: (s: string) => Buffer.from(s, 'binary').toString('base64'),
    prompt: () => opts.typed ?? null,
    PosAndroid: {
      print(id: string, ip: string, port: number, base64: string) {
        prints.push({ ip, port, bytes: [...Buffer.from(base64, 'base64')] });
        queueMicrotask(() => (win.__posAndroid as Answer)(id, opts.fail ?? null, null));
      },
      scan(id: string) {
        queueMicrotask(() => (win.__posAndroid as Answer)(id, null, JSON.stringify(opts.found ?? [])));
      },
    },
  };
  vi.stubGlobal('window', win);
  vi.stubGlobal('localStorage', storage());
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('alert', () => {});
  return { win, prints };
}

const DRAWER = [0x1B, 0x70, 0x00, 0x19, 0xFF];

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('the Android app bridge', () => {
  it('becomes posNative, so the kitchen queue runs there as in the exe', async () => {
    const { win } = android();
    const { isDesktop } = await import('@/lib/desktopPrint');
    expect(win.posNative).toBeDefined();
    expect(isDesktop()).toBe(true);
  });

  it('sends the bytes and waits for the app to say they went', async () => {
    const { win, prints } = android();
    await import('@/lib/desktopPrint');
    const native = win.posNative as { print: (ip: string, port: number, b: Uint8Array) => Promise<void> };
    await native.print('192.168.1.50', 9100, new Uint8Array([1, 2, 255]));
    expect(prints).toEqual([{ ip: '192.168.1.50', port: 9100, bytes: [1, 2, 255] }]);
  });

  it('passes a printer that did not answer back as an error, for the queue to retry', async () => {
    const { win } = android({ fail: 'timeout' });
    await import('@/lib/desktopPrint');
    const native = win.posNative as { print: (ip: string, port: number, b: Uint8Array) => Promise<void> };
    await expect(native.print('192.168.1.50', 9100, new Uint8Array([1]))).rejects.toThrow('timeout');
  });

  it('lists the printers the app found on the Wi-Fi', async () => {
    const { win } = android({ found: ['192.168.1.50', '192.168.1.51'] });
    await import('@/lib/desktopPrint');
    const native = win.posNative as { scanPrinters: () => Promise<string[]> };
    expect(await native.scanPrinters()).toEqual(['192.168.1.50', '192.168.1.51']);
  });

  it('encodes a whole receipt picture without overflowing the stack', async () => {
    const { toBase64 } = await import('@/lib/android-bridge');
    const big = new Uint8Array(300_000).map((_, i) => i % 256);
    const out = toBase64(big, s => Buffer.from(s, 'binary').toString('base64'));
    expect(Buffer.from(out, 'base64').equals(Buffer.from(big))).toBe(true);
  });

  it('loads menu pictures from the site, not the exe-only /_img cache', async () => {
    android();
    const { tillImage } = await import('@/lib/till-image');
    expect(tillImage('https://cdn.example.com/a.jpg')).toBe('https://cdn.example.com/a.jpg');
  });
});

describe('the receipt printer on the Android till', () => {
  it('asks for the Wi-Fi IP once, then prints there', async () => {
    const { prints } = android({ typed: ' 192.168.1.60 ' });
    const printer = await import('@/lib/printer');
    expect(await printer.connectPrinter()).toBe(false);
    expect(await printer.selectPrinter()).toBe(true);
    expect(await printer.connectPrinter()).toBe(true);
    expect(await printer.openCashDrawer()).toBe(true);
    expect(prints).toEqual([{ ip: '192.168.1.60', port: 9100, bytes: DRAWER }]);
  });

  it('does not keep an IP that is not one', async () => {
    android({ typed: 'printer' });
    const printer = await import('@/lib/printer');
    expect(await printer.selectPrinter()).toBe(false);
    expect(await printer.connectPrinter()).toBe(false);
  });

  it('says it did not print when the printer is off, so the till offers to pick again', async () => {
    android({ typed: '192.168.1.60', fail: 'timeout' });
    const printer = await import('@/lib/printer');
    await printer.selectPrinter();
    expect(await printer.openCashDrawer()).toBe(false);
  });

  it('prints a sex set to "USB" on the same receipt printer', async () => {
    const { prints } = android({ typed: '192.168.1.60' });
    const printer = await import('@/lib/printer');
    await printer.selectPrinter();
    await printer.printRawToUsb(new Uint8Array([7]));
    expect(prints).toEqual([{ ip: '192.168.1.60', port: 9100, bytes: [7] }]);
  });
});

describe('the exe', () => {
  it('keeps its USB receipt printer, even with a Wi-Fi IP left in storage', async () => {
    const print = vi.fn(async () => {});
    const local = storage();
    local.setItem('restoran_receipt_printer_ip', '192.168.1.60');
    vi.stubGlobal('window', { posNative: { isDesktop: true, print, till: {} } });
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('navigator', { usb: { getDevices: async () => [] } });
    const printer = await import('@/lib/printer');
    expect(await printer.connectPrinter()).toBe(false);
    expect(await printer.openCashDrawer()).toBe(false);
    expect(print).not.toHaveBeenCalled();
  });

  it('still serves menu pictures from its own cache', async () => {
    vi.stubGlobal('window', { posNative: { isDesktop: true, till: {} } });
    const { tillImage } = await import('@/lib/till-image');
    expect(tillImage('https://cdn.example.com/a.jpg')).toBe('/_img?src=https%3A%2F%2Fcdn.example.com%2Fa.jpg');
  });
});

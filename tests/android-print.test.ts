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

type Found = { id: string; name: string }[];

/**
 * An Android WebView: PosAndroid, no WebUSB. `fail` makes every print refuse.
 * `local` is an APK that also prints on USB and Bluetooth (LocalPrinters.java):
 * the printers it finds, or the error Android gives instead.
 */
function android(opts: { fail?: string; found?: string[]; local?: { usb?: Found; bt?: Found | string } } = {}) {
  const prints: { ip: string; port: number; bytes: number[] }[] = [];
  const local: { way: string; id: string; bytes: number[] }[] = [];
  const reply = (id: string, error: string | null, result: string | null) =>
    queueMicrotask(() => (win.__posAndroid as Answer)(id, error, result));
  const localCalls = opts.local ? {
    usbList: (id: string) => reply(id, null, JSON.stringify(opts.local!.usb ?? [])),
    usbPrint: (id: string, key: string, b64: string) => { local.push({ way: 'usb', id: key, bytes: [...Buffer.from(b64, 'base64')] }); reply(id, opts.fail ?? null, null); },
    btList: (id: string) => {
      const bt = opts.local!.bt ?? [];
      reply(id, typeof bt === 'string' ? bt : null, typeof bt === 'string' ? null : JSON.stringify(bt));
    },
    btPrint: (id: string, mac: string, b64: string) => { local.push({ way: 'bt', id: mac, bytes: [...Buffer.from(b64, 'base64')] }); reply(id, opts.fail ?? null, null); },
  } : {};
  const win: Record<string, unknown> = {
    btoa: (s: string) => Buffer.from(s, 'binary').toString('base64'),
    PosAndroid: {
      ...localCalls,
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
  return { win, prints, local };
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

/**
 * Answers the till's popups (lib/dialog-queue.ts) as the cashier would, one
 * answer per question in turn; an alert is just closed. Returns what was asked.
 */
async function answering(answers: (number | string | null)[]): Promise<string[]> {
  const { tillDialogs } = await import('@/lib/dialog-queue');
  const asked: string[] = [];
  const seen = new Set<number>();
  tillDialogs.subscribe(() => {
    const cur = tillDialogs.current();
    if (!cur || seen.has(cur.id)) return;
    seen.add(cur.id);
    asked.push(cur.title);
    const answer = cur.kind === 'alert' ? true : answers.shift() ?? null;
    queueMicrotask(() => tillDialogs.answer(cur.id, answer));
  });
  return asked;
}

describe('the receipt printer on the Android till', () => {
  it('asks for the Wi-Fi IP once, then prints there', async () => {
    const { prints } = android();
    const asked = await answering([' 192.168.1.60 ']);
    const printer = await import('@/lib/printer');
    expect(await printer.connectPrinter()).toBe(false);
    expect(await printer.selectPrinter()).toBe(true);
    expect(asked).toEqual(['Çek printerinin IP ünvanı']);
    expect(await printer.connectPrinter()).toBe(true);
    expect(await printer.openCashDrawer()).toBe(true);
    expect(prints).toEqual([{ ip: '192.168.1.60', port: 9100, bytes: DRAWER }]);
  });

  it('does not keep an IP that is not one', async () => {
    android();
    const asked = await answering(['printer']);
    const printer = await import('@/lib/printer');
    expect(await printer.selectPrinter()).toBe(false);
    expect(asked).toEqual(['Çek printerinin IP ünvanı', 'IP düzgün deyil']);
    expect(await printer.connectPrinter()).toBe(false);
  });

  it('says it did not print when the printer is off, so the till offers to pick again', async () => {
    android({ fail: 'timeout' });
    await answering(['192.168.1.60']);
    const printer = await import('@/lib/printer');
    await printer.selectPrinter();
    expect(await printer.openCashDrawer()).toBe(false);
  });

  it('prints a sex set to "USB" on the same receipt printer', async () => {
    const { prints } = android();
    await answering(['192.168.1.60']);
    const printer = await import('@/lib/printer');
    await printer.selectPrinter();
    await printer.printRawToUsb(new Uint8Array([7]));
    expect(prints).toEqual([{ ip: '192.168.1.60', port: 9100, bytes: [7] }]);
  });
});

// Clopos prints on a phone's USB cable, Bluetooth, and a Sunmi's built-in
// printer (a paired Bluetooth device); our APK could only reach Wi-Fi.
describe('a USB or Bluetooth printer on the Android till', () => {
  const WIFI = 0, USB_WAY = 1, BT = 2;

  it('prints on the USB printer that was picked, and remembers it', async () => {
    const { local, prints } = android({ local: { usb: [{ id: '0416:5011', name: 'XP-58' }] } });
    const asked = await answering([USB_WAY]);
    const printer = await import('@/lib/printer');
    expect(await printer.connectPrinter()).toBe(false);
    expect(await printer.selectPrinter()).toBe(true);
    expect(asked).toEqual(['Çek printeri necə qoşulub?']);
    expect(await printer.connectPrinter()).toBe(true);
    expect(printer.getSavedPrinter()).toBe('XP-58');
    expect(await printer.openCashDrawer()).toBe(true);
    expect(local).toEqual([{ way: 'usb', id: '0416:5011', bytes: DRAWER }]);
    expect(prints).toEqual([]);
  });

  it("asks which one when several are paired, and prints a Sunmi's built-in printer over Bluetooth", async () => {
    const { local } = android({ local: { bt: [{ id: 'AA:BB:CC:DD:EE:FF', name: 'Headphones' }, { id: '00:11:22:33:44:55', name: 'InnerPrinter' }] } });
    const asked = await answering([BT, 1]);
    const printer = await import('@/lib/printer');
    expect(await printer.selectPrinter()).toBe(true);
    expect(asked).toEqual(['Çek printeri necə qoşulub?', 'Hansı printer?']);
    await printer.printRawToUsb(new Uint8Array([7]));   // a sex set to "USB"
    expect(local).toEqual([{ way: 'bt', id: '00:11:22:33:44:55', bytes: [7] }]);
  });

  it('says why when Bluetooth is off, and keeps the old printer', async () => {
    android({ local: { bt: 'bluetooth off' } });
    const asked = await answering([BT]);
    const printer = await import('@/lib/printer');
    expect(await printer.selectPrinter()).toBe(false);
    expect(asked[1]).toMatch(/^Bluetooth söndürülüb/);
    expect(await printer.connectPrinter()).toBe(false);
  });

  it('says no printer when nothing is on the cable', async () => {
    android({ local: { usb: [] } });
    const asked = await answering([USB_WAY]);
    const printer = await import('@/lib/printer');
    expect(await printer.selectPrinter()).toBe(false);
    expect(asked[1]).toMatch(/^USB printer tapılmadı/);
  });

  it('goes back to Wi-Fi when the IP is picked again', async () => {
    const { local, prints } = android({ local: { usb: [{ id: '0416:5011', name: 'XP-58' }] } });
    await answering([USB_WAY, WIFI, '192.168.1.60']);
    const printer = await import('@/lib/printer');
    await printer.selectPrinter();
    await printer.selectPrinter();
    expect(await printer.openCashDrawer()).toBe(true);
    expect(prints).toEqual([{ ip: '192.168.1.60', port: 9100, bytes: DRAWER }]);
    expect(local).toEqual([]);
  });

  it('says it did not print when the printer is off, so the till offers to pick again', async () => {
    android({ fail: 'USB printer not plugged in', local: { usb: [{ id: '0416:5011', name: 'XP-58' }] } });
    await answering([USB_WAY]);
    const printer = await import('@/lib/printer');
    await printer.selectPrinter();
    expect(await printer.openCashDrawer()).toBe(false);
  });
});

/** A USB printer as WebUSB hands it over, recording what was sent to it. */
function usbPrinter(sent: number[][]) {
  return {
    configuration: { interfaces: [{ interfaceNumber: 0, alternates: [{ endpoints: [{ direction: 'out', type: 'bulk', endpointNumber: 1 }] }] }] },
    open: async () => {},
    claimInterface: async () => {},
    releaseInterface: async () => {},
    close: async () => {},
    transferOut: async (_e: number, b: Uint8Array) => { sent.push([...b]); },
  };
}

/** The exe: posNative and WebUSB both. `usb` is the printer on the cable, if any. */
function exe(opts: { usb?: ReturnType<typeof usbPrinter>; local?: ReturnType<typeof storage> } = {}) {
  const print = vi.fn(async () => {});
  const local = opts.local ?? storage();
  vi.stubGlobal('window', { posNative: { isDesktop: true, print, till: {} } });
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('navigator', {
    usb: {
      getDevices: async () => (opts.usb ? [opts.usb] : []),
      requestDevice: async () => { if (!opts.usb) throw new Error('No device selected'); return opts.usb; },
    },
  });
  return { print, local };
}

const USB = 0;
const IP = 1;

describe('the exe', () => {
  it('asks USB or IP, and USB prints on the cable', async () => {
    const sent: number[][] = [];
    const { print } = exe({ usb: usbPrinter(sent) });
    const asked = await answering([USB]);
    const printer = await import('@/lib/printer');
    expect(await printer.selectPrinter()).toBe(true);
    expect(asked).toEqual(['Çek printeri necə qoşulub?']);
    expect(await printer.openCashDrawer()).toBe(true);
    expect(sent).toEqual([DRAWER]);
    expect(print).not.toHaveBeenCalled();
  });

  it('picks IP even with a USB printer on the cable, then prints on the LAN', async () => {
    const sent: number[][] = [];
    const { print } = exe({ usb: usbPrinter(sent) });
    const asked = await answering([IP, '192.168.1.60']);
    const printer = await import('@/lib/printer');
    expect(await printer.connectPrinter()).toBe(true);           // the USB one, until IP is picked
    expect(await printer.selectPrinter()).toBe(true);
    expect(asked).toEqual(['Çek printeri necə qoşulub?', 'Çek printerinin IP ünvanı']);
    expect(await printer.openCashDrawer()).toBe(true);
    expect(print).toHaveBeenCalledWith('192.168.1.60', 9100, new Uint8Array(DRAWER));
    expect(sent).toEqual([]);
  });

  it('remembers IP after a restart, and sends a "USB" sex there too', async () => {
    const first = exe();
    await answering([IP, '192.168.1.60']);
    expect(await (await import('@/lib/printer')).selectPrinter()).toBe(true);

    vi.resetModules();
    const sent: number[][] = [];
    const { print } = exe({ usb: usbPrinter(sent), local: first.local });
    const printer = await import('@/lib/printer');
    expect(await printer.connectPrinter()).toBe(true);
    await printer.printRawToUsb(new Uint8Array([7]));
    expect(print).toHaveBeenCalledWith('192.168.1.60', 9100, new Uint8Array([7]));
    expect(sent).toEqual([]);
  });

  it('goes back to USB when USB is picked again', async () => {
    const sent: number[][] = [];
    const { print } = exe({ usb: usbPrinter(sent) });
    await answering([IP, '192.168.1.60', USB]);
    const printer = await import('@/lib/printer');
    await printer.selectPrinter();
    await printer.selectPrinter();
    expect(await printer.openCashDrawer()).toBe(true);
    expect(sent).toEqual([DRAWER]);
    expect(print).not.toHaveBeenCalled();
  });

  it('keeps USB with a LAN IP left in storage, until IP is picked', async () => {
    const local = storage();
    local.setItem('restoran_receipt_printer_ip', '192.168.1.60');
    const { print } = exe({ local });
    const printer = await import('@/lib/printer');
    expect(await printer.connectPrinter()).toBe(false);
    expect(await printer.openCashDrawer()).toBe(false);
    expect(print).not.toHaveBeenCalled();
  });

  it('has no printer when the choice is closed', async () => {
    const { print } = exe();
    await answering([null]);
    const printer = await import('@/lib/printer');
    expect(await printer.selectPrinter()).toBe(false);
    expect(await printer.openCashDrawer()).toBe(false);
    expect(print).not.toHaveBeenCalled();
  });

  it('never asks USB or IP in the browser, which has no socket to reach a LAN printer', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', storage());
    vi.stubGlobal('navigator', { usb: { getDevices: async () => [], requestDevice: async () => { throw new Error('none'); } } });
    const asked = await answering([IP, '192.168.1.60']);
    const printer = await import('@/lib/printer');
    expect(await printer.selectPrinter()).toBe(false);
    expect(asked).toEqual([]);
  });

  // A USB printer allows one program at a time. The till held it from page
  // load, so with the till open in Chrome the exe on the same PC could not print.
  describe('shares the USB printer with another program on the PC', () => {
    /** One USB printer, two programs: `other` is the second program holding it. */
    function shared(sent: number[][]) {
      const state = { mine: false, other: false };
      const p = {
        ...usbPrinter(sent),
        open: async () => { if (state.other) throw new Error('Access denied'); state.mine = true; },
        close: async () => { state.mine = false; },
      };
      return { p, state };
    }

    it('lets go of it after finding it and after every print', async () => {
      const sent: number[][] = [];
      const { p, state } = shared(sent);
      exe({ usb: p });
      const printer = await import('@/lib/printer');
      expect(await printer.connectPrinter()).toBe(true);
      expect(state.mine).toBe(false);
      expect(await printer.openCashDrawer()).toBe(true);
      expect(sent).toEqual([DRAWER]);
      expect(state.mine).toBe(false);
    });

    it('waits for the other program to finish printing, then prints', async () => {
      const sent: number[][] = [];
      const { p, state } = shared(sent);
      exe({ usb: p });
      const printer = await import('@/lib/printer');
      await printer.connectPrinter();
      state.other = true;
      setTimeout(() => { state.other = false; }, 100);
      expect(await printer.openCashDrawer()).toBe(true);
      expect(sent).toEqual([DRAWER]);
    });
  });

  it('still serves menu pictures from its own cache', async () => {
    vi.stubGlobal('window', { posNative: { isDesktop: true, till: {} } });
    const { tillImage } = await import('@/lib/till-image');
    expect(tillImage('https://cdn.example.com/a.jpg')).toBe('/_img?src=https%3A%2F%2Fcdn.example.com%2Fa.jpg');
  });
});

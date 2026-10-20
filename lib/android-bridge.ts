// The Android till: the same web page, inside the app in android/.
//
// A browser cannot open a socket to a printer, and that is the whole reason the
// app exists. Its Java side puts one object on the page, window.PosAndroid,
// with the two things the exe's posNative does for printers: send bytes to an
// IP, and find the printers on the Wi-Fi. This turns that object into the same
// posNative the exe has, so the kitchen queue, the sexes' printer screen and
// the receipt all run unchanged.
//
// What the Android till does not have is the exe's local database (`till`), so
// it reads and writes through the site like the browser till, and stops when
// the internet does.
//
// Java answers later, not as a return value: every call carries an id, and the
// app calls window.__posAndroid(id, error, result) when the socket is done.

import type { PosNative } from './desktopPrint';

/** The object android/…/PrinterBridge.java puts on the page. */
export interface AndroidPrinterBridge {
  print(id: string, ip: string, port: number, base64: string, timeoutMs: number): void;
  scan(id: string): void;
}

type Answer = (id: string, error: string | null, result: string | null) => void;

interface AndroidWindow {
  PosAndroid?: AndroidPrinterBridge;
  posNative?: PosNative;
  __posAndroid?: Answer;
  btoa(data: string): string;
}

// Same as lib/tcp-print.ts: a printer that is off never answers at all.
const PRINT_MS = 5_000;

export function toBase64(bytes: Uint8Array, btoa: (s: string) => string): string {
  // In slices: String.fromCharCode(...bytes) on a whole receipt picture
  // overflows the call stack.
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(text);
}

/** posNative for the Android app, built on its PosAndroid object. */
export function androidNative(win: AndroidWindow): PosNative {
  const bridge = win.PosAndroid!;
  const waiting = new Map<string, { resolve: (r: string | null) => void; reject: (e: Error) => void }>();
  let next = 0;

  win.__posAndroid = (id, error, result) => {
    const call = waiting.get(id);
    if (!call) return;
    waiting.delete(id);
    if (error) call.reject(new Error(error));
    else call.resolve(result);
  };

  function ask(send: (id: string) => void): Promise<string | null> {
    const id = String(++next);
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      try {
        send(id);
      } catch (err) {
        waiting.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  return {
    // Desktop in every way the page asks about printing: it drains the kitchen
    // queue and shows the sexes' printer screen. Without `till`, nothing else
    // changes.
    isDesktop: true,
    async print(ip, port, bytes, timeoutMs) {
      await ask(id => bridge.print(id, ip, port, toBase64(bytes, s => win.btoa(s)), timeoutMs ?? PRINT_MS));
    },
    async scanPrinters() {
      return JSON.parse((await ask(id => bridge.scan(id))) ?? '[]') as string[];
    },
  };
}

/** Inside the Android app, give the page its posNative. Anywhere else, nothing. */
export function installAndroidBridge(): void {
  if (typeof window === 'undefined') return;
  const win = window as unknown as AndroidWindow;
  if (!win.PosAndroid || win.posNative) return;
  win.posNative = androidNative(win);
}

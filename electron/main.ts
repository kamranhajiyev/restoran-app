// The Windows desktop shell.
//
// It is the same web app in a native window. The only thing it adds is the one
// capability a browser is not allowed to have: opening a TCP socket to a
// printer on 192.168.x.x. That is what kitchen tickets need, and why the old
// agent/ existed as a separate program holding a service-role key.
//
// Nothing here knows about Supabase. The page signs in as an ordinary waiter,
// claims its own restaurant's tickets under RLS, builds the ESC/POS bytes, and
// asks this process to put them on the wire. No key is ever shipped to a
// customer's machine.

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { sendToPrinter } from '../lib/tcp-print';

// Which site this build opens. Resolved at run time rather than hardcoded, so
// the same shell can be pointed at production, a branch preview, or a laptop —
// testing kitchen printing against the live restaurant is not an option.
//
//   1. --url=…              a shortcut's arguments, per machine
//   2. POS_APP_URL=…        development
//   3. package.json posUrl  baked in at build time by the workflow's url input
//   4. the production site
const DEFAULT_URL = 'https://www.possiblle.com';

function resolveAppUrl(): string {
  const flag = process.argv.find(a => a.startsWith('--url='))?.slice('--url='.length);
  if (flag) return flag;
  if (process.env.POS_APP_URL) return process.env.POS_APP_URL;
  try {
    // The packaged app.asar root, and the repo root when run from source.
    const meta = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'),
    ) as { posUrl?: string };
    if (meta.posUrl) return meta.posUrl;
  } catch {
    // No package.json beside us, or it is unreadable: use the default.
  }
  return DEFAULT_URL;
}

const APP_URL = resolveAppUrl();

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    title: 'Possiblle POS',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Painting a half-loaded page looks like a crash on a slow restaurant
  // connection. Wait until there is something to show.
  win.once('ready-to-show', () => win.show());
  void win.loadURL(APP_URL);

  keepTryingWhenOffline(win);

  // A misplaced target="_blank" must not open a second, chromeless copy of the
  // POS that the waiter cannot get out of. Send those to the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  grantReceiptPrinterAccess(win);
}

// ── Opening while the line is down ───────────────────────────────────────────
// Once the till has been opened at least once, its service worker holds the
// page and Chromium serves it from cache — a dropout mid-service costs nothing.
//
// A cold start during an outage is the case that needs help: there is nothing to
// intercept the navigation, so the window lands on Chromium's error page and the
// restaurant sees a dead app. Rather than leave them there, say what is
// happening in their own language and keep retrying, so the till comes back by
// itself the moment the line does.
// The cause is printed small at the bottom. A waiter has no use for it, but
// "no connection" covers a dead router, a blocked domain and a certificate the
// PC refuses alike — without the code there is nothing to tell them apart from
// a support call.
const offlineNotice = (code: number, desc: string, url: string) => `
  <style>
    body { margin:0; height:100vh; display:flex; align-items:center; justify-content:center;
           font-family:system-ui,-apple-system,Segoe UI,sans-serif; background:#faf9f7; color:#44403c; }
    .box { text-align:center; max-width:28rem; padding:2rem; }
    h1 { font-size:1.25rem; margin:0 0 .5rem; }
    p { margin:0; color:#78716c; font-size:.9rem; line-height:1.5; }
    .dot { display:inline-block; width:.5rem; height:.5rem; border-radius:50%;
           background:#f59e0b; margin-right:.4rem; animation:p 1.4s infinite; }
    @keyframes p { 0%,100%{opacity:1} 50%{opacity:.3} }
    .why { margin-top:1.5rem; color:#a8a29e; font-size:.7rem; word-break:break-all; }
  </style>
  <div class="box">
    <h1><span class="dot"></span>İnternet bağlantısı yoxdur</h1>
    <p>Proqram bağlantı bərpa olunan kimi özü açılacaq.<br>Pəncərəni bağlamayın.</p>
    <p class="why">${code} ${desc}<br>${url}</p>
  </div>
`;

function keepTryingWhenOffline(win: BrowserWindow): void {
  let retry: ReturnType<typeof setTimeout> | undefined;

  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    // Sub-resources fail for their own reasons, and -3 is a navigation the app
    // itself cancelled — neither means the restaurant is offline.
    if (!isMainFrame || code === -3) return;

    void win.webContents.executeJavaScript(
      `document.documentElement.innerHTML = ${JSON.stringify(offlineNotice(code, desc, url || APP_URL))}`,
    ).catch(() => {});
    win.show();

    if (retry) clearTimeout(retry);
    retry = setTimeout(() => void win.loadURL(url || APP_URL), 5000);
  });

  win.webContents.on('did-finish-load', () => {
    if (retry) { clearTimeout(retry); retry = undefined; }
  });

  win.on('closed', () => { if (retry) clearTimeout(retry); });
}

// ── The USB receipt printer ──────────────────────────────────────────────────
// The till's own printer is driven from the page over WebUSB, not through the
// station queue. Chrome asks the user to pick the device; Electron asks the
// application instead, and an app that answers nothing leaves the picker empty
// forever — the receipt printer simply stops working inside the desktop build
// while continuing to work in a browser tab.
//
// There is exactly one printer worth picking, so pick it rather than showing a
// chooser: a waiter mid-service should not be identifying USB devices.
const PRINTER_VID = 0x1fc9;
const PRINTER_PID = 0x2016;

const isReceiptPrinter = (d: { vendorId: number; productId: number }) =>
  d.vendorId === PRINTER_VID && d.productId === PRINTER_PID;

function grantReceiptPrinterAccess(win: BrowserWindow): void {
  // An allowlist, not a blanket yes: this window loads a remote page, and the
  // only device-level things the POS legitimately needs are the printer and the
  // "order ready" notification. Camera, microphone and location are not part of
  // the product, so nothing should be able to ask for them silently.
  const ALLOWED = new Set(['usb', 'notifications', 'clipboard-sanitized-write']);
  win.webContents.session.setPermissionCheckHandler((_wc, permission) =>
    ALLOWED.has(permission),
  );
  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(ALLOWED.has(permission)),
  );

  // Consulted both for a fresh request and for navigator.usb.getDevices() after
  // a restart, which is what makes the printer reconnect on its own instead of
  // asking to be paired again every morning.
  win.webContents.session.setDevicePermissionHandler(details =>
    details.deviceType === 'usb' && !!details.device && isReceiptPrinter(details.device as
      { vendorId: number; productId: number }),
  );

  // Fired on the session, not on webContents.
  win.webContents.session.on('select-usb-device', (event, details, callback) => {
    event.preventDefault();
    const printer = details.deviceList.find(isReceiptPrinter);
    // No printer attached: answer with nothing so requestDevice() rejects and
    // the page shows its own "Yazici tapilmadi", rather than hanging on a
    // picker that will never be answered.
    callback(printer?.deviceId);
  });
}

// Two copies of the POS on one machine would each claim tickets, and the second
// window is always an accident — a double-clicked shortcut mid-service.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  void app.whenReady().then(() => {
    ipcMain.handle('printer:send', async (_event, ip: unknown, port: unknown, bytes: unknown) => {
      // The renderer is a remote page. Validate rather than trust it: this
      // handler opens sockets to arbitrary addresses on the local network.
      if (typeof ip !== 'string' || !ip) throw new Error('bad printer ip');
      if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('bad printer port');
      }
      if (!(bytes instanceof Uint8Array)) throw new Error('bad payload');
      await sendToPrinter(ip, port, bytes);
    });

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

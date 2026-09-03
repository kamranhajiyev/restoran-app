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

import { app, BrowserWindow, ipcMain, net, protocol, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sendToPrinter } from '../lib/tcp-print';
import { openDb } from './db';
import { IMG_PATH, serveImage } from './images';
import { registerTillHandlers } from './till-ipc';

// ── The till, served off the disk ────────────────────────────────────────────
// A restaurant's line goes down and the till has to keep taking orders. That is
// impossible while the app's own HTML lives on possiblle.com: the first reload
// after a dropout lands on nothing, and a browser cache is not something to bet
// a service on — Windows may drop it, and a machine that has never been online
// never had one.
//
// So the till ships inside the installer as static files (see
// scripts/build-desktop.mjs) and is served from a scheme of our own. A custom
// scheme rather than file:// because the till needs a real origin: localStorage
// that survives a restart, and crypto.subtle for the offline PIN, both of which
// a file:// page is refused.
const SCHEME = 'app';
const ORIGIN = `${SCHEME}://till`;

// dist-electron/electron/main.js → the app root, packaged inside app.asar or the
// repo when run from source.
const BUNDLE = path.join(__dirname, '..', '..', 'out-desktop');

function hasBundle(): boolean {
  return fs.existsSync(path.join(BUNDLE, 'seller', 'index.html'));
}

// Without this the pages loaded over app:// are treated as neither secure nor
// standard: no localStorage, no crypto.subtle, and the till cannot even hold a
// session. Must run before app ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

/** Map a request path onto a file in the export, or null if it escapes it. */
function resolveBundleFile(pathname: string): string | null {
  // Percent-escapes first, so an encoded traversal is not smuggled past the
  // check below.
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  // The export is built with trailingSlash, so a directory address is a page.
  if (rel.endsWith('/')) rel += 'index.html';

  const file = path.join(BUNDLE, rel);
  // A page loaded from here can ask for any path it likes. Refuse anything that
  // resolves outside the export — the rest of the disk is not ours to serve.
  const within = path.relative(BUNDLE, file);
  if (within.startsWith('..') || path.isAbsolute(within)) return null;

  if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;

  // A client-side route arriving without its slash.
  const asPage = path.join(BUNDLE, rel, 'index.html');
  if (fs.existsSync(asPage)) return asPage;

  return null;
}

function serveBundle(): void {
  protocol.handle(SCHEME, req => {
    const url = new URL(req.url);

    // Menu photographs, served off the disk. Under the till's own origin rather
    // than a scheme of their own, so an <img> in the page needs no permission
    // and no CORS. See electron/images.ts.
    if (url.pathname === IMG_PATH) return serveImage(url);

    const file = resolveBundleFile(url.pathname);
    if (!file) {
      // Next writes a 404 page into the export; use it rather than a bare
      // Chromium error, so a mistyped route still looks like the app.
      const notFound = path.join(BUNDLE, '404.html');
      if (fs.existsSync(notFound)) {
        return net.fetch(pathToFileURL(notFound).toString(), { bypassCustomProtocolHandlers: true });
      }
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(file).toString(), { bypassCustomProtocolHandlers: true });
  });
}

// Which site this build opens when it is *not* serving the bundled till.
//
// Resolved at run time rather than hardcoded, so the same shell can be pointed
// at production, a branch preview, or a laptop — testing kitchen printing
// against the live restaurant is not an option.
//
//   1. --url=…              a shortcut's arguments, per machine
//   2. POS_APP_URL=…        development
//   3. package.json posUrl  baked in at build time by the workflow's url input
//   4. the production site
const DEFAULT_URL = 'https://www.possiblle.com';

/** An explicit instruction to load a site instead of the bundle. */
function remoteOverride(): string | null {
  const flag = process.argv.find(a => a.startsWith('--url='))?.slice('--url='.length);
  if (flag) return flag;
  return process.env.POS_APP_URL ?? null;
}

function resolveAppUrl(): string {
  const override = remoteOverride();
  if (override) return override;
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

// Which site the till's /api routes live on.
//
// Normally the same site the app would have opened. They are separate settings
// because the bundled till does not open a site at all, and the two questions
// stopped being the same one: the page comes from the disk, while the outbox and
// the terminal-link check still have to reach a real server — and it must be the
// server backed by the same database the till was built against. A till built
// with the testing project and syncing to production would check a terminal link
// against a company that only exists in the other database, and report a
// perfectly good link as wrong.
//
//   1. --api=…        a shortcut's arguments, per machine
//   2. POS_API_URL=…  development, and how a bundled till is pointed at a preview
//   3. whatever site this build would otherwise have opened
function resolveApiUrl(): string {
  const flag = process.argv.find(a => a.startsWith('--api='))?.slice('--api='.length);
  return flag ?? process.env.POS_API_URL ?? APP_URL;
}

const API_URL = resolveApiUrl();

// Serve the bundled till unless told otherwise. `--url=` and POS_APP_URL stay
// the way to point this shell at a preview deploy, which is how kitchen
// printing gets tested without a build; and a shell that somehow ships without
// an export still opens the site rather than nothing.
const BUNDLED = !remoteOverride() && hasBundle();

// Where the till was last time, so a cold start during an outage opens the till
// rather than the home page.
//
// Only the remote path needs this. A bundled till is on the disk: it opens at
// /seller every time, and the page itself decides whether that means the PIN
// pad or the login screen.
//
// The service worker caches the till's own address — /seller, or /s/<slug>/<token>
// for the terminal this app runs — and deliberately not the home page: caching a
// marketing page would only let someone stare at a screen with no way in. So on a
// morning when the line is already down, loading APP_URL lands on nothing, while
// the till the waiter used yesterday is sitting in the cache unreachable.
//
// Remembering the last address closes that. Only same-origin addresses are kept:
// a build pointed at production must never reopen a preview.
function lastUrlFile(): string {
  return path.join(app.getPath('userData'), 'last-url.txt');
}

function rememberUrl(url: string): void {
  try {
    if (new URL(url).origin !== new URL(APP_URL).origin) return;
    fs.writeFileSync(lastUrlFile(), url, 'utf8');
  } catch {
    // Unparseable URL, or a read-only profile. Next start just uses APP_URL.
  }
}

function startUrl(): string {
  if (BUNDLED) return `${ORIGIN}/seller/`;
  try {
    const saved = fs.readFileSync(lastUrlFile(), 'utf8').trim();
    if (saved && new URL(saved).origin === new URL(APP_URL).origin) return saved;
  } catch {
    // Nothing remembered yet — the first run, which is necessarily online.
  }
  return APP_URL;
}

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
  void win.loadURL(startUrl());

  // Only the remote path can fail to load. The bundled till is on the disk, so
  // there is no outage for it to recover from.
  if (!BUNDLED) keepTryingWhenOffline(win);

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
  // Chromium reports its own error page as a finished load. Without this the
  // address of a page that failed would be remembered as a good one.
  let failed = false;
  // Whether a real page has ever been on screen in this window.
  let loadedOnce = false;

  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    // Sub-resources fail for their own reasons, and -3 is a navigation the app
    // itself cancelled — neither means the restaurant is offline.
    if (!isMainFrame || code === -3) return;
    failed = true;

    // The notice is for a window with nothing in it. Once the till is up it
    // handles an outage itself — queueing writes, serving its own screens from
    // the cache — and overwriting the document here would throw away the open
    // orders on it to announce a condition the till is already handling. That
    // is the whole feature failing at the one moment it exists for.
    if (loadedOnce) return;

    void win.webContents.executeJavaScript(
      `document.documentElement.innerHTML = ${JSON.stringify(offlineNotice(code, desc, url || APP_URL))}`,
    ).catch(() => {});
    win.show();

    if (retry) clearTimeout(retry);
    retry = setTimeout(() => void win.loadURL(url || APP_URL), 5000);
  });

  win.webContents.on('did-finish-load', () => {
    if (retry) { clearTimeout(retry); retry = undefined; }
    if (!failed) {
      loadedOnce = true;
      rememberUrl(win.webContents.getURL());
    }
    failed = false;
  });

  // The app routes on the client, so walking from the home page into the till
  // never reloads and never fires did-finish-load. Without this the address
  // remembered would only ever be the one the window opened on.
  win.webContents.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    if (isMainFrame) rememberUrl(url);
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
    if (BUNDLED) {
      serveBundle();
      // Only the bundled till has a local database. A shell pointed at a site
      // with --url= is the web app in a window, and must keep going through the
      // API routes — its Supabase project may not even be the one this machine
      // synced from.
      openDb(app.getPath('userData'));
      registerTillHandlers(API_URL);
    }
    console.log(BUNDLED ? `[pos] serving the bundled till from ${BUNDLE}` : `[pos] loading ${APP_URL}`);
    if (BUNDLED) console.log(`[pos] syncing with ${API_URL}`);

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

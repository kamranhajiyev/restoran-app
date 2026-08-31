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

  // A misplaced target="_blank" must not open a second, chromeless copy of the
  // POS that the waiter cannot get out of. Send those to the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
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

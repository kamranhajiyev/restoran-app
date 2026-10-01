// Keeping the till up to date without anyone downloading an installer.
//
// A release reaches the restaurants only once it is *published* on GitHub: the
// workflow creates it as a draft, so a tagged build can be tried first and a bad
// one never leaves the building. /releases/latest does not return drafts.
//
// The new installer is fetched in the background and checked against the digest
// GitHub publishes for it. Nothing is installed until a person clicks "Yeni versiyanı yüklə":
// an update that arrives mid-shift is only offered, and the next time the app
// opens it is required — so a waiter is never thrown out of an open order, and
// no till is more than a day behind.
//
// Offline, nothing is found and nothing is blocked. A till must never be locked
// out by an update it cannot download.

import { app, BrowserWindow, ipcMain, net } from 'electron';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const REPO = 'kamranhajiyev/restoran-app';
const ASSET = 'PossibllePOS-Setup.exe';
const FIRST_CHECK_MS = 30_000;
const CHECK_EVERY_MS = 3 * 60 * 60 * 1000;

/** A downloaded, verified installer waiting to be run. */
interface Pending {
  version: string;
  file: string;
  // Set when the installer was started. Finding it still set on a start that is
  // not the new version means the install failed, and blocking on it again would
  // lock the till out for good.
  attempted?: boolean;
}

export interface UpdateStatus {
  version: string;
  // True when the update was already waiting as the app opened: the page then
  // refuses to be used until it is installed.
  required: boolean;
}

const dir = () => path.join(app.getPath('userData'), 'updates');
const pendingFile = () => path.join(dir(), 'pending.json');

let ready: Pending | null = null;
let required = false;
let busy = false;

/** 1 when a is newer than b. Plain numeric x.y.z — that is all the tags use. */
function compare(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

function readPending(): Pending | null {
  try {
    return JSON.parse(fs.readFileSync(pendingFile(), 'utf8')) as Pending;
  } catch {
    return null;
  }
}

function writePending(p: Pending): void {
  fs.writeFileSync(pendingFile(), JSON.stringify(p), 'utf8');
}

/** Drop every downloaded installer — after an update lands, or one failed. */
function clearDownloads(): void {
  try {
    fs.rmSync(dir(), { recursive: true, force: true });
  } catch {
    // A file still held open by a virus scanner. The next start tries again.
  }
}

function announce(): void {
  if (!ready) return;
  const status: UpdateStatus = { version: ready.version, required };
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('update:ready', status);
}

async function check(): Promise<void> {
  if (busy || ready) return;
  busy = true;
  try {
    const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return;
    const release = (await res.json()) as {
      tag_name: string;
      assets: { name: string; browser_download_url: string; digest?: string | null }[];
    };
    const version = release.tag_name.replace(/^v/, '');
    if (compare(version, app.getVersion()) <= 0) return;

    const asset = release.assets.find(a => a.name === ASSET);
    // Without GitHub's digest there is no way to tell a whole download from a
    // truncated one, and a half-written installer is not something to run.
    const expected = asset?.digest?.startsWith('sha256:') ? asset.digest.slice('sha256:'.length) : null;
    if (!asset || !expected) return;

    fs.mkdirSync(dir(), { recursive: true });
    const file = path.join(dir(), `PossibllePOS-Setup-${version}.exe`);
    const part = `${file}.part`;

    const dl = await net.fetch(asset.browser_download_url);
    if (!dl.ok || !dl.body) return;
    const hash = createHash('sha256');
    const body = Readable.fromWeb(dl.body as import('node:stream/web').ReadableStream);
    body.on('data', chunk => hash.update(chunk));
    await pipeline(body, fs.createWriteStream(part));

    if (hash.digest('hex') !== expected) {
      fs.rmSync(part, { force: true });
      console.warn(`[pos] update ${version} failed its checksum, discarded`);
      return;
    }
    fs.renameSync(part, file);

    ready = { version, file };
    writePending(ready);
    console.log(`[pos] update ${version} downloaded`);
    announce();
  } catch (err) {
    // Offline, GitHub down, rate-limited: try again at the next check.
    console.warn('[pos] update check failed:', err);
  } finally {
    busy = false;
  }
}

/** Run the installer silently and let it reopen the app as the new version. */
function install(): void {
  if (!ready) return;
  writePending({ ...ready, attempted: true });
  // --updated skips the installer's pages and keeps the shortcuts; /S makes it
  // silent; --force-run starts the app again once it is done. The till's data
  // lives in userData, which an update does not touch.
  const child = spawn(ready.file, ['--updated', '/S', '--force-run'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  app.quit();
}

export function startUpdater(): void {
  ipcMain.handle('update:status', (): UpdateStatus | null =>
    ready ? { version: ready.version, required } : null,
  );
  ipcMain.handle('update:install', () => install());

  // Only an installed Windows build can replace itself. From source there is
  // no installer to run, and macOS is a developer's machine.
  if (!app.isPackaged || process.platform !== 'win32') return;

  const pending = readPending();
  if (pending && compare(pending.version, app.getVersion()) > 0 && fs.existsSync(pending.file)) {
    if (pending.attempted) {
      // Ran last time and the app is still the old version: the install did not
      // take. Start over rather than block on it forever.
      console.warn(`[pos] update ${pending.version} did not install, discarded`);
      clearDownloads();
    } else {
      // Waiting since the last session — the app is just opening, so nobody is
      // in the middle of an order. This is the moment to insist.
      ready = pending;
      required = true;
    }
  } else if (pending) {
    // Already on that version (or newer): the update landed.
    clearDownloads();
  }

  setTimeout(() => void check(), FIRST_CHECK_MS);
  setInterval(() => void check(), CHECK_EVERY_MS);
}

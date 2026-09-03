// Menu photographs, kept on the restaurant's PC.
//
// Everything else the till needs is in SQLite by the time the line drops: the
// menu, the room, the staff, the open orders. The pictures are not — they are
// Supabase storage URLs inside the menu docs, and a `<img src="https://…">` on
// a machine with no internet is a grey box. A waiter picking drinks off a grid
// of grey boxes is slower than one reading a list, so this is not cosmetic.
//
// The bytes are cached on disk rather than in the database. They are large,
// immutable, and re-downloadable; putting them in till.db would bloat the one
// file that must stay quick to open and safe to copy.
//
// ── How a picture is addressed ───────────────────────────────────────────────
// The docs keep the remote URL, untouched. Nothing rewrites them, because an
// order snapshots its menu item and that snapshot is replayed to the server —
// a local path baked into a doc would end up in Postgres.
//
// Instead the page asks for `/_img?src=<remote url>` (lib/till-image.ts), which
// this module answers from the cache, falling back to fetching it once and
// keeping it. So the first online look at the menu is what fills the cache, and
// every look after that is local.

import { app, net } from 'electron';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Same origin as the till itself; see the protocol handler in main.ts. */
export const IMG_PATH = '/_img';

/** Big enough for a menu photo, small enough that a wrong URL cannot fill a disk. */
const MAX_BYTES = 8 * 1024 * 1024;

const TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
};

let _dir: string | null = null;

function dir(): string {
  if (!_dir) {
    _dir = path.join(app.getPath('userData'), 'images');
    fs.mkdirSync(_dir, { recursive: true });
  }
  return _dir;
}

/**
 * The file a remote URL is kept in.
 *
 * Named by a hash of the whole URL, so two items with the same filename in
 * different folders do not collide, and a re-uploaded photo (a new storage
 * path) is a different file rather than a stale one.
 */
function fileFor(url: string): { file: string; type: string } {
  const key = createHash('sha256').update(url).digest('hex');
  let ext = path.extname(new URL(url).pathname).toLowerCase();
  if (!TYPES[ext]) ext = '.jpg';
  return { file: path.join(dir(), key + ext), type: TYPES[ext] };
}

/** Only http(s), and only a URL — anything else is not ours to fetch. */
function usable(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function read(file: string, type: string): Response {
  const body = fs.readFileSync(file);
  return new Response(new Uint8Array(body), {
    headers: {
      'content-type': type,
      // The name carries the hash of the source URL, so a cached answer can
      // never be the wrong picture. Let Chromium keep it in memory too.
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}

/**
 * Put one picture in the cache. Quiet on failure: an outage, a deleted object
 * and a 404 are all "no picture", and none of them is worth interrupting a
 * service for.
 */
export async function fetchImage(url: string): Promise<boolean> {
  if (!usable(url)) return false;
  const { file } = fileFor(url);
  if (fs.existsSync(file)) return true;

  try {
    const res = await net.fetch(url);
    if (!res.ok) return false;

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return false;

    // Written beside the target and renamed, so a download cut off halfway
    // through cannot leave a truncated file that every later read trusts.
    const tmp = `${file}.part`;
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Warm the cache for a whole menu, a few at a time.
 *
 * Called after a sync (lib/till-sync.ts), while there is certainly a line —
 * waiting for the waiter to open each category would mean the pictures are
 * cached only for the parts of the menu someone happened to look at before the
 * outage.
 */
export async function cacheImages(urls: string[]): Promise<{ cached: number }> {
  const todo = [...new Set(urls.filter(usable))];
  let cached = 0;
  const workers = Array.from({ length: 4 }, async () => {
    for (let u = todo.pop(); u !== undefined; u = todo.pop()) {
      if (await fetchImage(u)) cached++;
    }
  });
  await Promise.all(workers);
  return { cached };
}

/**
 * Answer `/_img?src=…` for the till's protocol handler.
 *
 * A miss with a line fetches and keeps it; a miss without one is a 404, which
 * renders exactly as today's broken remote image and never blocks the page.
 */
export async function serveImage(url: URL): Promise<Response> {
  const src = url.searchParams.get('src');
  if (!src || !usable(src)) return new Response('Not found', { status: 404 });

  const { file, type } = fileFor(src);
  if (fs.existsSync(file)) return read(file, type);
  if (await fetchImage(src)) return read(file, type);
  return new Response('Not found', { status: 404 });
}

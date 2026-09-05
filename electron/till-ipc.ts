// What the till is allowed to ask the machine for.
//
// A named handler per operation, mirroring the /api/public-* routes the web
// till calls. Deliberately not a general "run this SQL" bridge: electron/
// preload.ts has exactly one job today — put bytes on a printer socket — and
// the reason it is that narrow is that this window has historically loaded a
// remote page. Keeping the surface enumerable means the worst a compromised
// renderer can do is read its own restaurant's menu.

import { ipcMain, net } from 'electron';
import type { CashShift, Order } from '../types';
import { db, getMeta, setMeta } from './db';
import { cacheImages } from './images';
import * as repo from './till-repo';
import { applyWrite, outboxAll, outboxAttempted, outboxCount, outboxDrop } from './till-write';

/** Handler arguments arrive from the renderer: check them, never trust them. */
function asCompanyId(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('bad companyId');
  return value;
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('bad payload');
  }
  return value as Record<string, unknown>;
}

function asRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('bad rows');
  return value.map(asObject);
}

export function registerTillHandlers(appUrl: string): void {
  // Where the till's own API routes live.
  //
  // The bundled page is served from app://till, so a relative fetch('/api/…')
  // resolves against a scheme that has no server behind it. Everything the till
  // *reads* is local and never asks; the outbox replay is the one code path that
  // must reach the real site, and this is how it learns the address rather than
  // hardcoding possiblle.com into the renderer.
  ipcMain.handle('till:origin', () => ({ origin: appUrl }));

  // ── Which restaurant this machine belongs to ───────────────────────────────
  // A till is installed once and then used by staff who have no account and
  // should not have the owner's password. The manager pastes the terminal link
  // on the first morning; this remembers it, and every start after that opens
  // straight at the PIN pad — including a start with no line at all, which is
  // why it lives on the disk and not in a login session.
  //
  // The record holds the link plus the last answer the server gave about it
  // (company, name, branding), so an outage does not turn a working till into a
  // "paste your link" screen. It is not a credential: the token is checked
  // against the server whenever there is a line, and a revoked one stops the
  // till then.
  const LINK_KEY = 'terminal_link';

  ipcMain.handle('till:link', () => ({ link: getMeta(db(), LINK_KEY) }));

  ipcMain.handle('till:setLink', (_e, value) => {
    if (value !== null && typeof value !== 'string') throw new Error('bad link');
    // JSON.stringify(null) is the string "null", which reads back as "linked to
    // nothing" — store the literal so clearing is unambiguous.
    setMeta(db(), LINK_KEY, value === null ? '' : value);
    return { ok: true };
  });

  // ── The owner's switches ───────────────────────────────────────────────────
  //
  // Kassa on or off, tables on or off, whether a receipt prints. They belong to
  // the company, not to the machine, but the machine has to obey them with the
  // cable out — and until this existed the till could not read them at all
  // without a session, so it fell back to "everything on" and a Kassa an owner
  // had switched off went on selling.
  //
  // Kept per company: one machine re-pointed at another restaurant must not
  // inherit the first one's settings.
  const SETTINGS_KEY = (companyId: string) => `settings:${companyId}`;

  ipcMain.handle('till:settings', (_e, companyId) => {
    const raw = getMeta(db(), SETTINGS_KEY(asCompanyId(companyId)));
    if (!raw) return { settings: null };
    try {
      return { settings: JSON.parse(raw) as unknown };
    } catch {
      return { settings: null };
    }
  });

  ipcMain.handle('till:putSettings', (_e, companyId, settings) => {
    if (!settings || typeof settings !== 'object') throw new Error('bad settings');
    setMeta(db(), SETTINGS_KEY(asCompanyId(companyId)), JSON.stringify(settings));
    return { ok: true };
  });

  // ── The one way out to the site ────────────────────────────────────────────
  //
  // The till's page is served from app://till, and the site it syncs with is
  // https://www.possiblle.com — a different origin, so a fetch from the page is
  // a cross-origin request the browser refuses before it is ever sent. The
  // routes send no CORS headers, and giving them some would open them to every
  // website on the internet, to solve a problem only this app has.
  //
  // The main process has no such rule, so the request is made here. Deliberately
  // not a general "fetch this URL" bridge: the path must be one of the routes
  // the till actually replays to, and the origin is the one this build was
  // pointed at — never one the renderer supplies.
  ipcMain.handle('till:api', async (_e, path, init) => {
    if (typeof path !== 'string' || !path.startsWith('/api/')) throw new Error('bad path');
    // A path is a path. Anything that could re-point the request at another host
    // — a scheme, a protocol-relative "//evil.test", a traversal — is refused.
    if (path.includes('..') || path.startsWith('//') || /[\r\n]/.test(path)) throw new Error('bad path');

    const opts = init && typeof init === 'object' ? (init as Record<string, unknown>) : {};
    const method = typeof opts.method === 'string' ? opts.method : 'GET';
    const headers = opts.headers && typeof opts.headers === 'object'
      ? (opts.headers as Record<string, string>)
      : undefined;
    const body = typeof opts.body === 'string' ? opts.body : undefined;

    const res = await net.fetch(`${appUrl.replace(/\/$/, '')}${path}`, { method, headers, body });
    // The status is carried back rather than thrown on, because the difference
    // between "the server refused this" and "there was no server" is the whole
    // of the replay's stop-or-drop decision (lib/sync.ts).
    return { ok: res.ok, status: res.status, body: await res.text() };
  });

  // ── Reads ──────────────────────────────────────────────────────────────────
  ipcMain.handle('till:menu', (_e, companyId) => ({ items: repo.getMenu(asCompanyId(companyId)) }));

  // Pull the menu's photographs onto the disk while there is a line. Bounded by
  // the caller's list, and every entry is checked to be an http(s) URL before
  // anything is fetched — this is the one handler that reaches outward, so it
  // must not become a way to make the app request arbitrary addresses.
  ipcMain.handle('till:cacheImages', async (_e, urls) => {
    if (!Array.isArray(urls)) throw new Error('bad urls');
    const list = urls.filter((u): u is string => typeof u === 'string').slice(0, 2000);
    return cacheImages(list);
  });

  ipcMain.handle('till:categories', (_e, companyId) => ({
    categories: repo.getCategories(asCompanyId(companyId)),
  }));

  ipcMain.handle('till:tables', (_e, companyId) => repo.getTables(asCompanyId(companyId)));

  ipcMain.handle('till:staff', (_e, companyId) => ({ staff: repo.getStaff(asCompanyId(companyId)) }));

  ipcMain.handle('till:couriers', (_e, companyId) => ({ couriers: repo.getCouriers(asCompanyId(companyId)) }));

  ipcMain.handle('till:modifiers', (_e, companyId) => ({
    groups: repo.getModifierGroups(asCompanyId(companyId)),
  }));

  ipcMain.handle('till:stations', (_e, companyId) => ({
    stations: repo.getStations(asCompanyId(companyId)),
  }));

  ipcMain.handle('till:stationReady', (_e, companyId) => ({
    ready: repo.getStationReady(asCompanyId(companyId)),
  }));

  ipcMain.handle('till:orders', (_e, companyId, opts) => {
    const o = opts === undefined ? {} : asObject(opts);
    return repo.getOrders(asCompanyId(companyId), {
      from: typeof o.from === 'string' ? o.from : undefined,
      to: typeof o.to === 'string' ? o.to : undefined,
      limit: typeof o.limit === 'number' ? o.limit : undefined,
      offset: typeof o.offset === 'number' ? o.offset : undefined,
    });
  });

  ipcMain.handle('till:shift', (_e, companyId) => ({
    shift: repo.getOpenShift(asCompanyId(companyId)),
  }));

  ipcMain.handle('till:shiftSales', (_e, companyId, openedAt) => {
    if (typeof openedAt !== 'string' || !openedAt) throw new Error('bad openedAt');
    return repo.getShiftSales(asCompanyId(companyId), openedAt);
  });

  // ── Filling the database ───────────────────────────────────────────────────
  // Used by the first-run setup and by the background refresh. One reference
  // table at a time, so the setup screen can report progress per step and
  // resume at the one that failed rather than starting over.
  ipcMain.handle('till:putReference', (_e, table, companyId, rows) => {
    const allowed = ['menu_items', 'categories', 'tables', 'halls', 'staff', 'couriers', 'modifier_groups', 'stations'] as const;
    type Ref = (typeof allowed)[number];
    if (typeof table !== 'string' || !allowed.includes(table as Ref)) throw new Error('bad table');
    repo.replaceReference(table as Ref, asCompanyId(companyId), asRows(rows));
    return { ok: true };
  });

  ipcMain.handle('till:putOrders', (_e, companyId, orders) => {
    const id = asCompanyId(companyId);
    for (const row of asRows(orders)) repo.putOrder(id, row as unknown as Order);
    return { ok: true };
  });

  ipcMain.handle('till:putStationReady', (_e, companyId, rows) => {
    repo.putStationReady(
      asCompanyId(companyId),
      asRows(rows).map(r => ({
        orderId: String(r.orderId),
        stationId: String(r.stationId),
        readyAt: String(r.readyAt ?? ''),
        readyBy: r.readyBy === null || r.readyBy === undefined ? null : String(r.readyBy),
      })),
    );
    return { ok: true };
  });

  ipcMain.handle('till:putShift', (_e, companyId, shift) => {
    repo.putShift(asCompanyId(companyId), asObject(shift) as unknown as CashShift);
    return { ok: true };
  });

  // ── Writes ─────────────────────────────────────────────────────────────────
  // One channel, not one per action. Unlike the reads above, every write already
  // names itself in its `kind` — the API route that will replay it — and
  // electron/till-write.ts refuses any kind it has not been taught. A channel
  // per action would be the same enumerable list written twice.
  ipcMain.handle('till:write', (_e, id, kind, body, companyId) => {
    if (typeof id !== 'string' || !id) throw new Error('bad id');
    if (typeof kind !== 'string' || !kind) throw new Error('bad kind');
    return applyWrite(id, kind, asObject(body), asCompanyId(companyId));
  });

  ipcMain.handle('till:outbox', () => ({ pending: outboxCount() }));

  // ── Draining the outbox ────────────────────────────────────────────────────
  // The sending itself happens in the renderer, not here. An outbox row is the
  // request that was never sent, and the renderer is where the session that may
  // send it lives — it already has the waiter's Supabase client and the replay
  // in lib/sync.ts. Doing it in this process would mean a second transport, a
  // second copy of the auth, and a service-role key on a restaurant's PC, which
  // is the one thing this whole design exists to avoid. So the main process owns
  // the queue and the renderer owns the wire.
  ipcMain.handle('till:outboxList', () => ({ entries: outboxAll() }));

  ipcMain.handle('till:outboxDrop', (_e, id) => {
    if (typeof id !== 'string' || !id) throw new Error('bad id');
    outboxDrop(id);
    return { ok: true };
  });

  ipcMain.handle('till:outboxAttempted', (_e, id) => {
    if (typeof id !== 'string' || !id) throw new Error('bad id');
    outboxAttempted(id);
    return { ok: true };
  });
}

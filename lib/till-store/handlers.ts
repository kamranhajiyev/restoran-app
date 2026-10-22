// What the till is allowed to ask its database for: posNative.till, by name.
//
// A named handler per operation, mirroring the /api/public-* routes the web
// till calls. Deliberately not a general "run this SQL" bridge: keeping the
// surface enumerable means the worst a compromised page can do is read its own
// restaurant's menu.
//
// One list for both apps. The exe puts each one behind an IPC channel of the
// same name (electron/till-ipc.ts); the Android app calls them in the page
// (lib/android-till.ts). The only parts that differ per machine — how to reach
// the site and where pictures are kept — come in as `Machine`.

import type { CashShift, Order } from '../../types';
import { tokenFromLink, withTillToken } from '../till-read-token';
import { db, getMeta, setMeta } from './db';
import * as repo from './repo';
import { applyWrite, nextOrderNumber, outboxAll, outboxAttempted, outboxCount, outboxDrop } from './write';

export interface ApiAnswer { ok: boolean; status: number; body: string }

export interface Machine {
  /** The site the till syncs with, e.g. https://www.possiblle.com. */
  appUrl: string;
  /** A request to the site, answered with its status rather than thrown on. */
  fetch(url: string, init: { method: string; headers?: Record<string, string>; body?: string }): Promise<ApiAnswer>;
  cacheImages(urls: string[]): Promise<{ cached: number }>;
}

/** Handler arguments arrive from the page: check them, never trust them. */
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

// ── The owner's switches ───────────────────────────────────────────────────
// Kassa on or off, tables on or off, whether a receipt prints. They belong to
// the company, not to the machine, but the machine has to obey them with the
// cable out — and until this existed the till could not read them at all
// without a session, so it fell back to "everything on" and a Kassa an owner
// had switched off went on selling.
//
// Kept per company: one machine re-pointed at another restaurant must not
// inherit the first one's settings.
const SETTINGS_KEY = (companyId: string) => `settings:${companyId}`;

const REFERENCE = ['menu_items', 'categories', 'tables', 'halls', 'staff', 'couriers', 'modifier_groups', 'stations'] as const;
type Reference = (typeof REFERENCE)[number];

export function tillHandlers(machine: Machine) {
  return {
    // Where the till's own API routes live. The page is served from the
    // machine, so a relative fetch('/api/…') has no server behind it; the
    // outbox replay is the one path that must reach the real site, and this is
    // how it learns the address.
    origin: () => ({ origin: machine.appUrl }),

    link: () => ({ link: getMeta(db(), LINK_KEY) }),

    setLink: (value: unknown) => {
      if (value !== null && typeof value !== 'string') throw new Error('bad link');
      // JSON.stringify(null) is the string "null", which reads back as "linked
      // to nothing" — store the literal so clearing is unambiguous.
      setMeta(db(), LINK_KEY, value === null ? '' : value);
      return { ok: true };
    },

    settings: (companyId: unknown) => {
      const raw = getMeta(db(), SETTINGS_KEY(asCompanyId(companyId)));
      if (!raw) return { settings: null };
      try {
        return { settings: JSON.parse(raw) as unknown };
      } catch {
        return { settings: null };
      }
    },

    putSettings: (companyId: unknown, settings: unknown) => {
      if (!settings || typeof settings !== 'object') throw new Error('bad settings');
      setMeta(db(), SETTINGS_KEY(asCompanyId(companyId)), JSON.stringify(settings));
      return { ok: true };
    },

    // ── The one way out to the site ──────────────────────────────────────────
    // The page's origin is the machine, the site is another one, and the routes
    // send no CORS headers — giving them some would open them to every website
    // on the internet, to solve a problem only the apps have. So the machine
    // makes the request. Deliberately not a general "fetch this URL" bridge:
    // the path must be one of the site's /api routes, and the origin is the one
    // this build was pointed at — never one the page supplies.
    api: async (path: unknown, init?: unknown): Promise<ApiAnswer> => {
      if (typeof path !== 'string' || !path.startsWith('/api/')) throw new Error('bad path');
      // A path is a path. Anything that could re-point the request at another
      // host — a scheme, a protocol-relative "//evil.test", a traversal — is
      // refused.
      if (path.includes('..') || path.startsWith('//') || /[\r\n]/.test(path)) throw new Error('bad path');

      const opts = init && typeof init === 'object' ? (init as Record<string, unknown>) : {};
      const method = typeof opts.method === 'string' ? opts.method : 'GET';
      // A read carries the till's token, taken from the saved link here rather
      // than from every caller in the page (lib/till-read-token.ts).
      const headers = withTillToken(
        path,
        opts.headers && typeof opts.headers === 'object' ? (opts.headers as Record<string, string>) : undefined,
        tokenFromLink(getMeta(db(), LINK_KEY)),
      );
      const body = typeof opts.body === 'string' ? opts.body : undefined;

      // The status is carried back rather than thrown on, because the
      // difference between "the server refused this" and "there was no server"
      // is the whole of the replay's stop-or-drop decision (lib/sync.ts).
      return machine.fetch(`${machine.appUrl.replace(/\/$/, '')}${path}`, { method, headers, body });
    },

    // Pull the menu's photographs onto the machine while there is a line.
    // Bounded, and every entry must be an http(s) URL — this is the one handler
    // that reaches outward, so it must not become a way to make the app request
    // arbitrary addresses.
    cacheImages: (urls: unknown) => {
      if (!Array.isArray(urls)) throw new Error('bad urls');
      const list = urls.filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u)).slice(0, 2000);
      return machine.cacheImages(list);
    },

    // ── Reads ────────────────────────────────────────────────────────────────
    menu: (companyId: unknown) => ({ items: repo.getMenu(asCompanyId(companyId)) }),
    categories: (companyId: unknown) => ({ categories: repo.getCategories(asCompanyId(companyId)) }),
    tables: (companyId: unknown) => repo.getTables(asCompanyId(companyId)),
    staff: (companyId: unknown) => ({ staff: repo.getStaff(asCompanyId(companyId)) }),
    couriers: (companyId: unknown) => ({ couriers: repo.getCouriers(asCompanyId(companyId)) }),
    modifiers: (companyId: unknown) => ({ groups: repo.getModifierGroups(asCompanyId(companyId)) }),
    stations: (companyId: unknown) => ({ stations: repo.getStations(asCompanyId(companyId)) }),
    nextOrderNumber: (companyId: unknown) => ({ orderNumber: nextOrderNumber(asCompanyId(companyId)) }),
    stationReady: (companyId: unknown) => ({ ready: repo.getStationReady(asCompanyId(companyId)) }),

    orders: (companyId: unknown, opts?: unknown) => {
      const o = opts === undefined ? {} : asObject(opts);
      return repo.getOrders(asCompanyId(companyId), {
        from: typeof o.from === 'string' ? o.from : undefined,
        to: typeof o.to === 'string' ? o.to : undefined,
        limit: typeof o.limit === 'number' ? o.limit : undefined,
        offset: typeof o.offset === 'number' ? o.offset : undefined,
      });
    },

    shift: (companyId: unknown) => ({ shift: repo.getOpenShift(asCompanyId(companyId)) }),

    shiftSales: (companyId: unknown, openedAt: unknown) => {
      if (typeof openedAt !== 'string' || !openedAt) throw new Error('bad openedAt');
      return repo.getShiftSales(asCompanyId(companyId), openedAt);
    },

    courierCollections: (companyId: unknown, from: unknown, to: unknown) => {
      if (typeof from !== 'string' || !from) throw new Error('bad from');
      if (typeof to !== 'string' || !to) throw new Error('bad to');
      return repo.getCourierCollections(asCompanyId(companyId), from, to);
    },

    // ── Filling the database ─────────────────────────────────────────────────
    // Used by the first-run setup and by the background refresh. One reference
    // table at a time, so the setup screen can report progress per step and
    // resume at the one that failed rather than starting over.
    putReference: (table: unknown, companyId: unknown, rows: unknown) => {
      if (typeof table !== 'string' || !REFERENCE.includes(table as Reference)) throw new Error('bad table');
      repo.replaceReference(table as Reference, asCompanyId(companyId), asRows(rows));
      return { ok: true };
    },

    putOrders: (companyId: unknown, orders: unknown) => {
      const id = asCompanyId(companyId);
      for (const row of asRows(orders)) repo.putOrder(id, row as unknown as Order);
      return { ok: true };
    },

    putStationReady: (companyId: unknown, rows: unknown) => {
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
    },

    putShift: (companyId: unknown, shift: unknown) => {
      repo.putShift(asCompanyId(companyId), asObject(shift) as unknown as CashShift);
      return { ok: true };
    },

    // ── Writes ───────────────────────────────────────────────────────────────
    // One handler, not one per action. Every write already names itself in its
    // `kind` — the API route that will replay it — and write.ts refuses any
    // kind it has not been taught.
    write: (id: unknown, kind: unknown, body: unknown, companyId: unknown) => {
      if (typeof id !== 'string' || !id) throw new Error('bad id');
      if (typeof kind !== 'string' || !kind) throw new Error('bad kind');
      return applyWrite(id, kind, asObject(body), asCompanyId(companyId));
    },

    outbox: () => ({ pending: outboxCount() }),

    // ── Draining the outbox ──────────────────────────────────────────────────
    // The sending itself happens in the page (lib/sync.ts), where the session
    // that may send it lives. The machine owns the queue; the page owns the wire.
    outboxList: () => ({ entries: outboxAll() }),

    outboxDrop: (id: unknown) => {
      if (typeof id !== 'string' || !id) throw new Error('bad id');
      outboxDrop(id);
      return { ok: true };
    },

    outboxAttempted: (id: unknown) => {
      if (typeof id !== 'string' || !id) throw new Error('bad id');
      outboxAttempted(id);
      return { ok: true };
    },
  };
}

export type TillHandlers = ReturnType<typeof tillHandlers>;

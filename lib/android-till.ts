// The Android till's own database: the same one the exe has, run in the page.
//
// The exe keeps its database in its main process, behind IPC. The Android app
// has no second process to run TypeScript in, so the shared code in
// lib/till-store/ runs here, in the page, and only SQLite itself is Java's:
// three calls on window.PosAndroid (android/…/TillDb.java). They answer at once,
// not later, because the till's reads and writes are synchronous in the exe too
// and transact() relies on nothing else running in between.
//
// Only the copy of the page the app carries inside it gets this. A page loaded
// from the site (the debug build, which opens `npm run dev`) reads through the
// site like the browser till, for the same reason the exe's --url= does.

import type { PosNative } from './desktopPrint';
import { attachDb, type SqlHandle } from './till-store/db';
import { tillHandlers, type ApiAnswer } from './till-store/handlers';

/** What TillDb.java and the rest of the app add to window.PosAndroid. */
export interface AndroidTillBridge {
  /** True only on the copy of the page inside the app. */
  hasTill?(): boolean;
  /** The site the till syncs with. */
  appUrl(): string;
  sqlExec(sql: string): string;
  sqlQuery(sql: string, params: string): string;
  sqlRun(sql: string, params: string): string;
  http(id: string, url: string, method: string, headers: string, body: string | null): void;
  cacheImages(id: string, urls: string): void;
}

/** Ask Java something that answers later, through window.__posAndroid. */
export type Ask = (send: (id: string) => void) => Promise<string | null>;

/**
 * SQL text split into statements. Java's execSQL runs only the first one, and
 * the schema is many. The till's SQL has no ';' inside a string, so a split on
 * it is enough once the comments are gone.
 */
export function statements(sql: string): string[] {
  return sql
    .split('\n')
    .map(line => line.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);
}

/** Parameters as JSON for Java, in the types node:sqlite would bind them as. */
export function paramsJson(params: unknown[]): string {
  return JSON.stringify(params.map(p => {
    if (p === undefined || p === null) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (typeof p === 'bigint') return Number(p);
    return p;
  }));
}

function answer<T>(raw: string): T {
  const parsed = JSON.parse(raw) as { error?: string } & T;
  if (parsed.error) throw new Error(parsed.error);
  return parsed;
}

/** node:sqlite's DatabaseSync, as far as the till uses it, over TillDb.java. */
export function javaSql(bridge: AndroidTillBridge): SqlHandle {
  return {
    exec(sql) {
      for (const s of statements(sql)) answer(bridge.sqlExec(s));
    },
    prepare(sql) {
      return {
        all: (...params) => answer<{ rows: Record<string, unknown>[] }>(bridge.sqlQuery(sql, paramsJson(params))).rows,
        get: (...params) => answer<{ rows: Record<string, unknown>[] }>(bridge.sqlQuery(sql, paramsJson(params))).rows[0],
        run: (...params) => answer<{ changes: number }>(bridge.sqlRun(sql, paramsJson(params))),
      };
    },
  };
}

/** posNative.till for the Android app, or undefined where it has none. */
export function androidTill(bridge: AndroidTillBridge, ask: Ask): PosNative['till'] {
  if (typeof bridge.hasTill !== 'function' || !bridge.hasTill()) return undefined;

  attachDb(javaSql(bridge));
  const handlers = tillHandlers({
    appUrl: bridge.appUrl(),
    fetch: async (url, init) => {
      const raw = await ask(id => bridge.http(id, url, init.method, JSON.stringify(init.headers ?? {}), init.body ?? null));
      return JSON.parse(raw ?? '{}') as ApiAnswer;
    },
    cacheImages: async urls => {
      const raw = await ask(id => bridge.cacheImages(id, JSON.stringify(urls)));
      return { cached: Number(raw) || 0 };
    },
  });

  // The page awaits every one, as it does the exe's IPC. A handler that throws
  // becomes a rejected promise there too.
  const till: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const [name, handler] of Object.entries(handlers)) {
    till[name] = async (...args) => (handler as (...a: unknown[]) => unknown)(...args);
  }
  return till as unknown as PosNative['till'];
}

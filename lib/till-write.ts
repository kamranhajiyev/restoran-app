// The till's writes, on the machine rather than on the wire.
//
// Companion to lib/till-data.ts, which does the same for reads. Inside the
// Windows app every write goes to SQLite first and the network never enters the
// question; in a browser tab there is no local database and this reports so, and
// the caller carries on exactly as it did before.
//
// The seam is one call rather than a function per action because the callers
// already agree on a vocabulary: the API route each write would have posted to,
// and the idempotency key it would have carried. Passing those straight through
// means the outbox row IS the request that was not sent, and electron/sync.ts
// can replay it without a translation layer in between.

import type { OutboxEntry, PosNative } from "./desktopPrint";

export type { OutboxEntry };

/** The two writes that never had an API route. Mirrors electron/till-write.ts. */
export const ADD_ORDER = "supabase:addOrder";
export const MARK_READY = "supabase:markStationReady";
export const UNMARK_READY = "supabase:unmarkStationReady";

function local(): NonNullable<PosNative["till"]> | null {
  if (typeof window === "undefined") return null;
  return window.posNative?.till ?? null;
}

export function hasLocalDb(): boolean {
  return local() !== null;
}

export interface LocalWrite {
  ok: boolean;
  error?: string;
}

/**
 * Apply a write to this machine, or report that there is no machine to apply it
 * to.
 *
 * Returns null — not a failure — when this is a browser, or when the caller has
 * no company to scope the write to. Null means "not my job": the caller falls
 * through to the network path it used before, unchanged.
 */
/**
 * Called after every write that lands on the disk.
 *
 * One listener, replaced rather than accumulated: the till has one screen, and a
 * list here would quietly keep the old page's handler alive across a remount.
 */
let _onWrite: (() => void) | null = null;

export function onLocalWrite(fn: () => void): () => void {
  _onWrite = fn;
  return () => {
    if (_onWrite === fn) _onWrite = null;
  };
}

export async function localWrite(
  id: string,
  kind: string,
  body: Record<string, unknown>,
  companyId: string | null,
): Promise<LocalWrite | null> {
  const till = local();
  if (!till || !companyId) return null;

  try {
    const result = await till.write(id, kind, body, companyId);
    // Tell whoever is watching that there is something new to send. Without it
    // the outbox waits for the next sweep, and a sale taken on a machine with a
    // perfectly good line took three minutes to appear in the database — long
    // enough for an owner watching the admin panel to conclude it had been lost.
    _onWrite?.();
    return result;
  } catch (e) {
    // An IPC failure is the database refusing, not the network — there is no
    // network in this path. Surfacing it is right: the waiter must not be told
    // an order was saved when it was not.
    console.error("[localWrite]", kind, e);
    return { ok: false, error: e instanceof Error ? e.message : "local write failed" };
  }
}

/** How many writes are still waiting for Supabase. 0 when there is no local db. */
export async function pendingWrites(): Promise<number> {
  const till = local();
  if (!till) return 0;
  try {
    return (await till.outbox()).pending;
  } catch {
    return 0;
  }
}

// ── Draining ────────────────────────────────────────────────────────────────
// The three calls lib/sync.ts needs to treat the local outbox exactly as it
// treats the IndexedDB queue in a browser. Errors are not swallowed here: a
// failure to drop a sent entry would send it again, and sync.ts has to know.

/** Everything still waiting, oldest first. Empty when this is a browser. */
export async function pendingList(): Promise<OutboxEntry[]> {
  const till = local();
  if (!till) return [];
  return (await till.outboxList()).entries;
}

/** Supabase has it — stop carrying it. */
export async function dropWrite(id: string): Promise<void> {
  await local()?.outboxDrop(id);
}

/** Record that we tried, so an entry that keeps failing is visible as such. */
export async function attemptedWrite(id: string): Promise<void> {
  await local()?.outboxAttempted(id);
}

/**
 * Where a replayed `/api/…` write has to be sent.
 *
 * "" in a browser, where a relative URL is already right. In the desktop app the
 * page is served from app://till — a scheme with no server behind it — so a
 * relative fetch would post an order into the void and call it a 404. The shell
 * knows which site this build belongs to (production, or a preview passed with
 * --url=), and this asks it rather than baking an address into the bundle.
 */
let _base: string | null = null;

export async function apiBase(): Promise<string> {
  if (_base !== null) return _base;
  const till = local();
  if (!till) return (_base = "");
  try {
    _base = (await till.origin()).origin.replace(/\/$/, "");
  } catch {
    // An older shell without the handler. Relative is wrong here, but a failed
    // send is retried forever, which is the safe direction: nothing is dropped.
    _base = "";
  }
  return _base;
}

/**
 * POST one of the site's routes, from wherever the till happens to be running.
 *
 * In a browser it is an ordinary same-origin fetch. Inside the Windows app the
 * page is served from app://till, so the same call would resolve against a
 * scheme with no server behind it — the request never leaves, and the screen
 * reports a network problem on a machine that is perfectly connected. There it
 * goes out through the main process instead (electron/till-ipc.ts).
 *
 * Always resolves. Callers read `ok` and `error`, exactly as they did when this
 * was a fetch with a .catch on the end.
 */
export async function tillPost<T>(
  route: string,
  body: Record<string, unknown>,
): Promise<T> {
  const till = local();
  try {
    if (till) {
      const res = await till.api(route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      try {
        return JSON.parse(res.body) as T;
      } catch {
        return { ok: false, error: "network" } as T;
      }
    }
    const res = await fetch(route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as T;
  } catch {
    return { ok: false, error: "network" } as T;
  }
}

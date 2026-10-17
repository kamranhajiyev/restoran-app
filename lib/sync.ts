// Catching the server up once the line is back.
//
// Replays the queue in the order the till wrote it and stops at the first entry
// that cannot reach the server, because everything behind it may depend on it —
// resuming later from the same point is correct, skipping ahead is not.
//
// ── Two queues, one replay ───────────────────────────────────────────────────
// In a browser tab the queue is IndexedDB (lib/offline-queue.ts), holding the
// writes that could not be sent. In the Windows app it is the SQLite outbox
// (electron/till-write.ts), holding every write, because there the till always
// writes locally first and the network is never on the waiter's path.
//
// The two differ in where the rows live and in nothing else: an entry is the
// request that was not sent, keyed by its own idempotency key. So the loop below
// is written once against whichever queue this build has, and the desktop gets
// the replay discipline that a year of restaurant outages shaped, rather than a
// second implementation of it that has to learn the same lessons again.
//
// The sending happens here, in the page, and not in the Electron main process:
// this is where the waiter's Supabase session lives. Main has no session and no
// key — deliberately, since a service-role key on a restaurant's PC is the thing
// this whole design exists to avoid — so it owns the queue and the page owns the
// wire.

import { addOrder } from "@/lib/store";
import type { Order } from "@/types";
import { getAllQueued, dequeue, incrementAttempts, queueSize } from "@/lib/offline-queue";
import {
  apiBase, attemptedWrite, dropWrite, hasLocalDb, pendingList, pendingWrites,
} from "@/lib/till-write";
import type { PosNative } from "@/lib/desktopPrint";
import { readLink } from "@/lib/terminal-link";
import { getTillToken } from "@/lib/till-data";

/** The machine's own bridge, or null in a browser. */
function tillDb(): NonNullable<PosNative["till"]> | null {
  if (typeof window === "undefined") return null;
  return window.posNative?.till ?? null;
}

export type SyncResult = { synced: number; failed: number; stillQueued: number };

/** The one write that does not go through an API route. */
export const ADD_ORDER = "supabase:addOrder";

// What "there was no line" looks like, in every wording this code can be handed.
// The browser's own failures are the first half; the second is Chromium's, which
// is what the desktop till gets — electron/till-ipc.ts calls net.fetch in the
// main process, and a failure there arrives as `net::ERR_INTERNET_DISCONNECTED`
// or one of its neighbours. None of those contain the word "network" or "fetch",
// so they used to fall through to the "the server refused this" branch below and
// the write was deleted a second after the waiter made it — orders included,
// with the badge going green because the queue really was empty.
const NETWORK = /fetch|network|failed to fetch|load failed|timeout|econnrefused|aborted|net::err|enotfound|unreachable|disconnected|offline/i;
const ALREADY_APPLIED = /duplicate key|unique constraint|already exists/i;

/** How long one write may take before the queue gives up on it for now. */
export const SEND_MS = 15000;

/**
 * The promise, or a "timeout" error once `ms` has passed. A request that never
 * answers — a router that took the packet and did nothing — used to hold the
 * whole queue behind it until the till was restarted. The loser is abandoned,
 * not cancelled; every write carries an Idempotency-Key, so a late arrival is
 * harmless.
 */
export function withDeadline<T>(p: Promise<T>, ms = SEND_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Whether a refusal is the server failing rather than the server saying no.
 *
 * A 502 from Vercel or a 500 from a Supabase hiccup used to be read as "no",
 * and every write but an order was dropped on it — a payment included, so the
 * till showed the order paid while the server never heard of it. These answers
 * change on their own, so the write is kept and tried again.
 */
export function serverFailed(status: number | undefined): boolean {
  return status !== undefined && (status >= 500 || status === 408 || status === 429);
}

/**
 * Whether the server refused the link the write was sent with. The owner made
 * a new link, or the till is being re-linked: the write is still the
 * restaurant's sale, so it waits for a link that works instead of being dropped.
 */
export function linkRefused(r: { reason: string; status?: number }): boolean {
  return r.status === 401 || r.status === 403 || /revoked/i.test(r.reason);
}

/**
 * The body with the link the till holds now. A write queued before the owner
 * made a new link carries the old token, and would be refused for ever after.
 */
export function withCurrentToken(body: unknown, token: string | null): unknown {
  if (!token || !body || typeof body !== "object" || !("token" in body)) return body;
  return { ...(body as Record<string, unknown>), token };
}

/**
 * Whether a queued write belongs to another restaurant than the one open now.
 * Unknown on either side is not "another": a till signed in with an account
 * has no link company, and dropping on that deleted every sale it made.
 */
export function otherCompany(written: string | null, current: string | null): boolean {
  return !!written && !!current && written !== current;
}

/** Why an entry was not applied, and the HTTP status that said so, if any. */
type Refusal = { reason: string; status?: number };

/**
 * A new order from a browser tab opened by a terminal link, through the server.
 *
 * Such a tab has no account, so a straight insert goes in under the anon key —
 * and anon may no longer write orders (20261009_close_anon_doors.sql). Every
 * new order on the website till was refused with "İcazə xətası" the morning
 * those doors closed on production — Parviz, 2026-10-17.
 */
export async function sendOrderByLink(
  order: unknown, companyId: string, token: string, idempotencyKey: string, base = "",
): Promise<Refusal | null> {
  const r = await fetch(`${base}/api/add-order`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ order, companyId, token }),
  });
  const text = await r.text();
  const data = ((): { ok?: boolean; error?: unknown } => {
    try { return JSON.parse(text) as { ok?: boolean; error?: unknown }; }
    catch { return { ok: r.ok }; }
  })();
  if (r.ok && data.ok !== false) return null;
  return { reason: data.error ? String(data.error) : `http ${r.status}`, status: r.status };
}

/** The fields the replay needs. Both queues supply them under these names. */
export interface Pending {
  id: string;
  kind: string;
  body: unknown;
  companyId: string | null;
  /** When the till made the write. Both queues record it; only the badge reads it. */
  queuedAt?: string;
}

/** Where the writes waiting to be sent are kept, on this build. */
interface Queue {
  all(): Promise<Pending[]>;
  drop(id: string): Promise<void>;
  attempted(id: string): Promise<void>;
  size(): Promise<number>;
}

function queue(): Queue {
  return hasLocalDb()
    ? { all: pendingList, drop: dropWrite, attempted: attemptedWrite, size: pendingWrites }
    : { all: getAllQueued, drop: dequeue, attempted: incrementAttempts, size: queueSize };
}

/**
 * What has not reached the server yet, oldest first.
 *
 * The same rows the flush below walks, exposed so the badge can show a waiter
 * what is waiting rather than only how many. Read-only: nothing here sends.
 */
export async function pendingEntries(): Promise<Pending[]> {
  return queue().all();
}

/** Send one entry. Resolves to null on success, or why it was not applied. */
async function replay(item: Pending, base: string, local: boolean, token: string | null): Promise<Refusal | null> {
  if (item.kind === ADD_ORDER) {
    // `keepOrderNumber` only where the number is real. The desktop till assigned
    // it from its own database and has already printed it; a browser's queued
    // order carries the guess the screen made from the orders it could see, and
    // making that authoritative would hand out duplicates.
    const till = tillDb();

    // The desktop till posts it like every other write. It used to insert
    // straight into Supabase from the page, which made this the one write that
    // needed the anon key baked into the build to be right and RLS to admit an
    // unauthenticated terminal. When it was not, the sale was refused and
    // dropped, and the payment behind it then updated an order the server had
    // never seen — three of them, answering ok:false to a till showing green.
    if (till) {
      const link = await readLink();
      if (!link) return { reason: "link yoxdur" };
      const res = await till.api("/api/add-order", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": item.id },
        body: JSON.stringify({
          order: item.body,
          companyId: item.companyId,
          token: link.token,
          keepOrderNumber: true,
        }),
      });
      const data = ((): { ok?: boolean; error?: unknown } => {
        try { return JSON.parse(res.body) as { ok?: boolean; error?: unknown }; }
        catch { return { ok: res.ok }; }
      })();
      if (res.ok && data.ok !== false) return null;
      return { reason: data.error ? String(data.error) : `http ${res.status}`, status: res.status };
    }

    // A browser tab opened by a terminal link has no session: through the server.
    if (token && item.companyId) {
      return sendOrderByLink(item.body, item.companyId, token, item.id, base);
    }

    // A browser tab signed in has the waiter's own session, so it inserts as itself.
    // Re-inserting an order the server already has trips the primary key on the
    // till-generated id, which is the same answer as success.
    const error = await addOrder(item.body as Order, { server: true, keepOrderNumber: local });
    if (error === null || ALREADY_APPLIED.test(error)) return null;
    return { reason: error };
  }

  const headers = { "Content-Type": "application/json", "Idempotency-Key": item.id };
  const body = JSON.stringify(withCurrentToken(item.body, token));

  // Out through the main process on the desktop till. The page is served from
  // app://till, so this fetch is cross-origin and the browser refuses it before
  // it is sent — which arrives here as a network failure, and a network failure
  // is the one answer that makes the replay stop and keep the entry. The queue
  // would grow all night on a machine with a working connection, and the badge
  // would sit at "waiting" with nothing to wait for.
  const till = tillDb();
  const res = till
    ? await till.api(item.kind, { method: "POST", headers, body })
    : await (async () => {
        const r = await fetch(`${base}${item.kind}`, { method: "POST", headers, body });
        return { ok: r.ok, status: r.status, body: await r.text() };
      })();

  const data = ((): { ok?: boolean; error?: unknown } => {
    try { return JSON.parse(res.body) as { ok?: boolean; error?: unknown }; }
    catch { return { ok: res.ok }; }
  })();

  if (res.ok && data.ok !== false) return null;
  return { reason: data.error ? String(data.error) : `http ${res.status}`, status: res.status };
}

// The send already running, if any. The reconnect drain and the timer both
// call flushQueue; two at once read the same queue and sent each write twice.
let running: Promise<SyncResult> | null = null;

export function flushQueue(currentCompanyId: string | null): Promise<SyncResult> {
  if (running) return running;
  running = flushOnce(currentCompanyId).finally(() => { running = null; });
  return running;
}

async function flushOnce(currentCompanyId: string | null): Promise<SyncResult> {
  const local = hasLocalDb();
  const q = queue();
  const pending = await q.all();
  if (pending.length === 0) return { synced: 0, failed: 0, stillQueued: 0 };

  const base = await apiBase();
  const token = tillDb() ? (await readLink())?.token ?? null : getTillToken();

  let synced = 0;
  let failed = 0;

  for (const item of pending) {
    // A till that was re-pointed at another restaurant must not post the first
    // one's orders into it.
    if (otherCompany(item.companyId, currentCompanyId)) {
      await q.drop(item.id);
      failed++;
      continue;
    }

    await q.attempted(item.id);

    try {
      const refusal = await withDeadline(replay(item, base, local, token));
      if (refusal === null) {
        await q.drop(item.id);
        synced++;
        continue;
      }

      const error = refusal.reason;

      // Still no line, or the server failed on its side. Stop: the answer will
      // change, and the rest of the queue sits behind this one.
      if (NETWORK.test(error) || serverFailed(refusal.status) || linkRefused(refusal)) {
        failed++;
        break;
      }

      // A refused sale is kept. Everything else is dropped: the server
      // understood and said no, replaying will not change its mind, and holding
      // the entry blocks every write behind it.
      //
      // An order is the exception because it is the money, and because losing
      // one is silent — the till has it, the screen shows it, the badge goes
      // green, and only the end-of-day total disagrees. Nothing else in the
      // queue means anything without it either: the payment behind a dropped
      // order updates a row the server does not have. Better a queue that
      // visibly stops than a night of sales that quietly did not happen.
      if (item.kind === ADD_ORDER) {
        console.error("[sync] order rejected, keeping:", item.id, error);
        failed++;
        break;
      }

      console.error("[sync] rejected, dropping:", item.kind, item.id, error);
      await q.drop(item.id);
      failed++;
    } catch (e) {
      // Nothing came back at all. Dropping only ever makes sense when the server
      // answered and said no — a thrown error means it may never have been
      // asked, and the list of wordings for "the line is down" is not something
      // this code gets to be sure it has finished writing. So an error it does
      // not recognise is kept and the queue stops, which costs a retry; the
      // other way round it cost a night of sales.
      failed++;
      console.error("[sync] no answer, keeping:", item.kind, item.id, e);
      break;
    }
  }

  return { synced, failed, stillQueued: await q.size() };
}

/**
 * Which orders the server has not been told about yet.
 *
 * The badge answers "how many writes are waiting"; this answers the question a
 * waiter actually asks, which is about one order in front of them: is *this*
 * bill safe if the machine dies tonight. An order counts as unsent while
 * anything touching it is still in the queue — the order itself, a line added
 * to it, a quantity changed, the payment.
 *
 * Read-only. Nothing here sends.
 */
export async function pendingOrderIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const entry of await queue().all()) {
    const body = entry.body as { id?: unknown; orderId?: unknown } | null;
    if (!body || typeof body !== "object") continue;
    // The new-order entry carries the order itself; every other kind names it.
    const id = entry.kind === ADD_ORDER ? body.id : body.orderId;
    if (typeof id === "string" && id) ids.add(id);
  }
  return ids;
}

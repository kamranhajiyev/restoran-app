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

/** The machine's own bridge, or null in a browser. */
function tillDb(): NonNullable<PosNative["till"]> | null {
  if (typeof window === "undefined") return null;
  return window.posNative?.till ?? null;
}

export type SyncResult = { synced: number; failed: number; stillQueued: number };

/** The one write that does not go through an API route. */
export const ADD_ORDER = "supabase:addOrder";

const NETWORK = /fetch|network|failed to fetch|load failed|timeout|econnrefused|aborted/i;
const ALREADY_APPLIED = /duplicate key|unique constraint|already exists/i;

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

/** Send one entry. Resolves to null on success, or a reason to keep it. */
async function replay(item: Pending, base: string, local: boolean): Promise<string | null> {
  if (item.kind === ADD_ORDER) {
    // Re-inserting an order the server already has trips the primary key on the
    // till-generated id, which is the same answer as success.
    //
    // `keepOrderNumber` only where the number is real. The desktop till assigned
    // it from its own database and has already printed it; a browser's queued
    // order carries the guess the screen made from the orders it could see, and
    // making that authoritative would hand out duplicates.
    const error = await addOrder(item.body as Order, { server: true, keepOrderNumber: local });
    if (error === null || ALREADY_APPLIED.test(error)) return null;
    return error;
  }

  const headers = { "Content-Type": "application/json", "Idempotency-Key": item.id };
  const body = JSON.stringify(item.body);

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
  return data.error ? String(data.error) : `http ${res.status}`;
}

export async function flushQueue(currentCompanyId: string | null): Promise<SyncResult> {
  const local = hasLocalDb();
  const q = queue();
  const pending = await q.all();
  if (pending.length === 0) return { synced: 0, failed: 0, stillQueued: 0 };

  const base = await apiBase();

  let synced = 0;
  let failed = 0;

  for (const item of pending) {
    // A till that was re-pointed at another restaurant must not post the first
    // one's orders into it.
    if (item.companyId !== currentCompanyId) {
      await q.drop(item.id);
      failed++;
      continue;
    }

    await q.attempted(item.id);

    try {
      const error = await replay(item, base, local);
      if (error === null) {
        await q.drop(item.id);
        synced++;
        continue;
      }

      // Still no line. Stop: the rest of the queue sits behind this one.
      if (NETWORK.test(error)) {
        failed++;
        break;
      }

      // The server understood and refused. Replaying will not change its mind,
      // and holding the entry blocks every write behind it.
      console.error("[sync] rejected, dropping:", item.kind, item.id, error);
      await q.drop(item.id);
      failed++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failed++;
      if (NETWORK.test(msg)) break;
      console.error("[sync] unexpected, dropping:", item.kind, item.id, e);
      await q.drop(item.id);
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

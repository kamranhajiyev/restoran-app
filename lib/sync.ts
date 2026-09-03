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

  const res = await fetch(`${base}${item.kind}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": item.id },
    body: JSON.stringify(item.body),
  });
  const data = await res.json().catch(() => ({ ok: res.ok }));
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

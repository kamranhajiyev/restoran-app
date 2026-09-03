// Catching the server up once the line is back.
//
// Replays the queue in the order the till wrote it and stops at the first entry
// that cannot reach the server, because everything behind it may depend on it —
// resuming later from the same point is correct, skipping ahead is not.

import { addOrder } from "@/lib/store";
import type { Order } from "@/types";
import { getAllQueued, dequeue, incrementAttempts, queueSize, type QueuedMutation } from "@/lib/offline-queue";

export type SyncResult = { synced: number; failed: number; stillQueued: number };

/** The one write that does not go through an API route. */
export const ADD_ORDER = "supabase:addOrder";

const NETWORK = /fetch|network|failed to fetch|load failed|timeout|econnrefused|aborted/i;
const ALREADY_APPLIED = /duplicate key|unique constraint|already exists/i;

/** Send one entry. Resolves to null on success, or a reason to keep it. */
async function replay(item: QueuedMutation): Promise<string | null> {
  if (item.kind === ADD_ORDER) {
    // Re-inserting an order the server already has trips the primary key on the
    // till-generated id, which is the same answer as success.
    const error = await addOrder(item.body as Order);
    if (error === null || ALREADY_APPLIED.test(error)) return null;
    return error;
  }

  const res = await fetch(item.kind, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": item.id },
    body: JSON.stringify(item.body),
  });
  const data = await res.json().catch(() => ({ ok: res.ok }));
  if (res.ok && data.ok !== false) return null;
  return data.error ? String(data.error) : `http ${res.status}`;
}

export async function flushQueue(currentCompanyId: string | null): Promise<SyncResult> {
  const queue = await getAllQueued();
  if (queue.length === 0) return { synced: 0, failed: 0, stillQueued: 0 };

  let synced = 0;
  let failed = 0;

  for (const item of queue) {
    // A till that was re-pointed at another restaurant must not post the first
    // one's orders into it.
    if (item.companyId !== currentCompanyId) {
      await dequeue(item.id);
      failed++;
      continue;
    }

    await incrementAttempts(item.id);

    try {
      const error = await replay(item);
      if (error === null) {
        await dequeue(item.id);
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
      await dequeue(item.id);
      failed++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failed++;
      if (NETWORK.test(msg)) break;
      console.error("[sync] unexpected, dropping:", item.kind, item.id, e);
      await dequeue(item.id);
    }
  }

  return { synced, failed, stillQueued: await queueSize() };
}

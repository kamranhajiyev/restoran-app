// What the till did while the line was down.
//
// Every write the seller screen makes goes through here rather than straight to
// the network. Online, the entry is sent immediately and dropped. Offline, it
// waits in IndexedDB — surviving a reload, a crash, and the power cut that is
// usually why the connection went away in the first place — and is replayed in
// order once the line comes back. See lib/sync.ts for the replay.
//
// Two rules make the replay safe:
//
//   1. Strict FIFO, and a stop at the first network failure. "Add items to order
//      X" must never reach the server before the insert that creates order X.
//   2. Every entry carries a key the server remembers. A reply lost on the way
//      back means the till retries a write the server already applied; without
//      the key the guest is charged twice. See the idempotency table in
//      supabase/migrations.

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

const DB_NAME = "possiblle-offline";
const DB_VERSION = 1;
const STORE = "mutations";

/** A write the till made, waiting its turn at the server. */
export interface QueuedMutation {
  /** Also the idempotency key the server dedupes on. */
  id: string;
  /** Which API route, or "supabase:addOrder" for the one direct insert. */
  kind: string;
  body: unknown;
  companyId: string | null;
  /** Orders the replay. Monotonic, assigned on enqueue. */
  seq: number;
  queuedAt: string;
  attempts: number;
}

interface OfflineDB extends DBSchema {
  [STORE]: {
    key: string;
    value: QueuedMutation;
    indexes: { "by-seq": number };
  };
}

let _db: IDBPDatabase<OfflineDB> | null = null;

async function getDB(): Promise<IDBPDatabase<OfflineDB> | null> {
  if (_db) return _db;
  try {
    _db = await openDB<OfflineDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("by-seq", "seq");
      },
    });
    return _db;
  } catch {
    // Private-mode Safari refuses IndexedDB outright. The till still works, it
    // just cannot survive a dropout — better than refusing to open at all.
    return null;
  }
}

// Sequence numbers must keep climbing across reloads, or a replay after a
// refresh would interleave yesterday's writes with today's. Seeded once from
// the highest number already stored.
let _seq = 0;
let _seqReady: Promise<void> | null = null;

function ensureSeq(db: IDBPDatabase<OfflineDB>): Promise<void> {
  if (!_seqReady) {
    _seqReady = (async () => {
      const last = await db.getAllFromIndex(STORE, "by-seq");
      _seq = last.length ? last[last.length - 1].seq : 0;
    })();
  }
  return _seqReady;
}

export async function enqueue(
  id: string,
  kind: string,
  body: unknown,
  companyId: string | null,
): Promise<void> {
  const db = await getDB();
  if (!db) return;
  await ensureSeq(db);
  // Re-queuing the same id is the caller retrying, not a second write.
  if (await db.get(STORE, id)) return;
  await db.put(STORE, {
    id,
    kind,
    body,
    companyId,
    seq: ++_seq,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  });
}

/** Oldest first — the order the server must see them in. */
export async function getAllQueued(): Promise<QueuedMutation[]> {
  const db = await getDB();
  if (!db) return [];
  return db.getAllFromIndex(STORE, "by-seq");
}

export async function dequeue(id: string): Promise<void> {
  const db = await getDB();
  if (!db) return;
  await db.delete(STORE, id);
}

export async function incrementAttempts(id: string): Promise<void> {
  const db = await getDB();
  if (!db) return;
  const item = await db.get(STORE, id);
  if (!item) return;
  await db.put(STORE, { ...item, attempts: item.attempts + 1 });
}

export async function queueSize(): Promise<number> {
  const db = await getDB();
  if (!db) return 0;
  return db.count(STORE);
}

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Order } from "@/types";

const DB_NAME = "possiblle-offline";
const DB_VERSION = 1;
const STORE = "order-queue";

export interface QueuedOrder {
  id: string;
  order: Order;
  companyId: string;
  queuedAt: string;
  attempts: number;
}

interface OfflineDB extends DBSchema {
  [STORE]: {
    key: string;
    value: QueuedOrder;
    indexes: { "by-queued-at": string };
  };
}

let _db: IDBPDatabase<OfflineDB> | null = null;

async function getDB(): Promise<IDBPDatabase<OfflineDB> | null> {
  if (_db) return _db;
  try {
    _db = await openDB<OfflineDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("by-queued-at", "queuedAt");
      },
    });
    return _db;
  } catch {
    // iOS Safari private mode throws QuotaExceededError
    return null;
  }
}

export async function enqueueOrder(order: Order, companyId: string): Promise<void> {
  const db = await getDB();
  if (!db) return;
  const existing = await db.get(STORE, order.id);
  if (existing) return;
  await db.put(STORE, {
    id: order.id,
    order,
    companyId,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  });
}

export async function getAllQueued(): Promise<QueuedOrder[]> {
  const db = await getDB();
  if (!db) return [];
  return db.getAllFromIndex(STORE, "by-queued-at");
}

export async function dequeueOrder(id: string): Promise<void> {
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

export async function updateQueuedOrder(id: string, orderPatch: Partial<Order>): Promise<void> {
  const db = await getDB();
  if (!db) return;
  const item = await db.get(STORE, id);
  if (!item) return;
  await db.put(STORE, { ...item, order: { ...item.order, ...orderPatch } });
}

export async function queueSize(): Promise<number> {
  const db = await getDB();
  if (!db) return 0;
  return db.count(STORE);
}

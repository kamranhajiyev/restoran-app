import { Order, OrderItem } from '@/types';

// One `order_items` row as it comes back from PostgREST.
export interface OrderItemRow {
  id: string;
  menu_item_id: string;
  menu_item_name: string;
  menu_item_price: number;
  quantity: number;
  modifiers?: string | null;
  variant_id?: string | null;
  created_at?: string | null;
  removed_at?: string | null;
  removed_by?: string | null;
}

export function mapOrderItem(oi: OrderItemRow): OrderItem {
  return {
    id: oi.id,
    menuItem: {
      id: oi.menu_item_id,
      name: oi.menu_item_name,
      price: Number(oi.menu_item_price),
      category: '',
      available: true,
    },
    quantity: oi.quantity,
    modifiers: oi.modifiers ?? undefined,
    variantId: oi.variant_id ?? undefined,
    createdAt: oi.created_at ?? undefined,
    removedAt: oi.removed_at ?? undefined,
    removedBy: oi.removed_by ?? undefined,
  };
}

// Removed rows are kept OUT of `items`. Every total, the Analiz report, the Excel
// export and the customer receipt read `items` — a removed dish leaking in there
// would over-count revenue and over-charge the guest. Both read paths (lib/store
// fetchOrders and /api/public-orders) go through this one function so they cannot
// drift apart.
export function splitOrderItems(rows: OrderItemRow[] | null | undefined): {
  items: OrderItem[];
  removedItems: OrderItem[];
} {
  const items: OrderItem[] = [];
  const removedItems: OrderItem[] = [];
  for (const row of rows ?? []) {
    (row.removed_at ? removedItems : items).push(mapOrderItem(row));
  }
  return { items, removedItems };
}

// ── Rendering the order as a history ─────────────────────────────────────────

export interface ItemBatch {
  at: string;            // when this batch was added
  isFirst: boolean;      // the original order; later batches are "Əlavə"
  items: OrderItem[];    // active and removed, in one list
}

// When the order last changed *after* it was rung up — a later "Əlavə et", or an
// item taken off. Undefined for an untouched order: the original batch is the
// order itself, not a change to it.
//
// Read off the rows' own timestamps rather than tracked in the session, so every
// device agrees, a refresh doesn't forget, and it makes no difference whether the
// update arrived by realtime push or by the poll.
//
// Which batch is first is decided by itemBatches, NOT by comparing an item against
// order.createdAt: those are two different clocks. The order's stamp is written by
// the browser, its items land a moment later carrying the server's now(), and every
// new order would read as edited within a second of being placed.
//
// Instants, never strings: Postgres hands back "…41.208873+00:00" where an
// optimistic local update makes "…41.000Z", and the two sort differently inside
// the same second.
export function lastChangedAt(
  order: Pick<Order, 'items' | 'removedItems' | 'createdAt'>,
): string | undefined {
  let latest: string | undefined;
  let latestMs = -Infinity;
  const bump = (at: string | undefined) => {
    if (!at) return;
    const ms = Date.parse(at);
    if (!Number.isNaN(ms) && ms > latestMs) { latestMs = ms; latest = at; }
  };

  // Every batch after the first is an "Əlavə et".
  for (const batch of itemBatches(order)) {
    if (!batch.isFirst) bump(batch.at);
  }
  // A removal is a change whichever batch the dish was ordered in.
  for (const item of order.removedItems ?? []) bump(item.removedAt);

  return latest;
}

// Every row inserted by one statement shares a single now(), so a batch *is* one
// press of "Sifariş ver" or "Əlavə et". Removed rows are folded back in at their
// own timestamp: a fully-removed item stays in the batch it was ordered in, while
// a partial removal's ghost row appears at the moment it was taken away.
export function itemBatches(order: Pick<Order, 'items' | 'removedItems' | 'createdAt'>): ItemBatch[] {
  const all = [...order.items, ...(order.removedItems ?? [])];
  if (all.length === 0) return [];

  const byTime = new Map<string, OrderItem[]>();
  for (const item of all) {
    // No createdAt (a cart item, or a row predating the migration) belongs to the
    // original order rather than floating into a batch of its own.
    const key = item.createdAt ?? order.createdAt;
    const bucket = byTime.get(key);
    if (bucket) bucket.push(item); else byTime.set(key, [item]);
  }

  return [...byTime.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([at, items], i) => ({ at, isFirst: i === 0, items }));
}

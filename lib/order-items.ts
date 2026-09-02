import { Order, OrderItem, SelectedModifier } from '@/types';

// One `order_items` row as it comes back from PostgREST.
export interface OrderItemRow {
  id: string;
  menu_item_id: string;
  menu_item_name: string;
  menu_item_price: number;
  quantity: number;
  modifiers?: string | null;
  modifiers_detail?: SelectedModifier[] | null;
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
    modifiersDetail: oi.modifiers_detail ?? undefined,
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

// ── Auditing a receipt ───────────────────────────────────────────────────────

// Three things worth a second look on a closed receipt: a line taken off after the
// order was placed, a discount, and a free close. Each is legitimate on its own —
// together on one admin list they are what an owner audits, because the classic
// theft is print the order, serve the food, delete the line, keep the cash.
export function orderSuspicion(o: Pick<Order, 'removedItems' | 'discountAmount' | 'status'>) {
  return {
    hasRemovals: (o.removedItems?.length ?? 0) > 0,
    discounted:  (o.discountAmount ?? 0) > 0,
    freeClosed:  o.status === 'ləğv edildi',
  };
}

export function isSuspiciousOrder(o: Pick<Order, 'removedItems' | 'discountAmount' | 'status'>): boolean {
  const s = orderSuspicion(o);
  return s.hasRemovals || s.discounted || s.freeClosed;
}

// When the order was closed — paid or cancelled. Undefined while it is still open.
// An order can only take one of those two exits, so the order of the fallback
// never decides anything.
export function orderClosedAt(o: Pick<Order, 'paidAt' | 'cancelledAt'>): string | undefined {
  return o.paidAt ?? o.cancelledAt;
}

// ── Rendering the order as a history ─────────────────────────────────────────

export interface ItemBatch {
  at: string;            // when this batch was added
  isFirst: boolean;      // the original order; later batches are "Əlavə"
  items: OrderItem[];    // active and removed, in one list
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

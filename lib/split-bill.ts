// "Hesabı böl": one table's bill becomes several, one per guest.
//
// Every dish is cut into single pieces (4 Capucino → four rows of 1) and each
// piece is given to a guest. Guest 1 keeps the original order; the others
// become new orders on the same table. A dish sold by weight (0.35 kq) cannot
// be cut, so it stays one piece. A set or a dish with modifiers is one line
// already, so each of its pieces moves whole.

// Relative imports only: the exe's offline store (lib/till-store) uses this file.
import type { Order, OrderItem } from '../types';
import { dishesTotal, serviceAmount } from './service-charge';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface SplitPiece {
  /** Which line of the order this piece came from. */
  line: number;
  item: OrderItem;
  /** 1, or the whole quantity of a line that cannot be cut. */
  quantity: number;
}

export function splitPieces(items: OrderItem[]): SplitPiece[] {
  return items.flatMap((item, line) =>
    Number.isInteger(item.quantity) && item.quantity > 1
      ? Array.from({ length: item.quantity }, () => ({ line, item, quantity: 1 }))
      : [{ line, item, quantity: item.quantity }],
  );
}

export interface SplitPart {
  guest: number;
  /** The guest's lines, a line's pieces put back together. */
  items: OrderItem[];
  dishes: number;
  charge: number;
  total: number;
}

/** Each guest's bill. `owner[i]` is the guest (1, 2, …) holding piece i. */
export function splitParts(
  pieces: SplitPiece[],
  owner: number[],
  guests: number,
  serviceChargePercent = 0,
): SplitPart[] {
  return Array.from({ length: guests }, (_, g) => {
    const guest = g + 1;
    const byLine = new Map<number, OrderItem>();
    pieces.forEach((p, i) => {
      if (owner[i] !== guest) return;
      const had = byLine.get(p.line);
      byLine.set(p.line, had ? { ...had, quantity: round2(had.quantity + p.quantity) } : { ...p.item, quantity: p.quantity });
    });
    const items = [...byLine.values()];
    const dishes = round2(dishesTotal(items));
    const charge = serviceAmount(dishes, serviceChargePercent);
    return { guest, items, dishes, charge, total: round2(dishes + charge) };
  });
}

/** The split may go ahead: at least two guests have something on their bill. */
export function canSplit(parts: SplitPart[]): boolean {
  return parts.filter(p => p.items.length > 0).length >= 2;
}

// ── The request ─────────────────────────────────────────────────────────────
// What split_order() (20261107_split_order.sql), /api/split-order and the exe's
// own copy all take: one entry per new bill, each naming the lines it takes and
// how many. Guest 1 is not in it — they keep the original order.

export interface SplitLine {
  /** The original order's line. */
  id: string;
  /** How many of it move; all of them moves the line itself. */
  quantity: number;
  /** The id for the moved part when only part moves. */
  newId: string;
}

export interface SplitRequestPart {
  orderId: string;
  /** Set by the exe, which numbers its own orders; the server keeps it. */
  orderNumber?: number;
  tillNumber?: number;
  lines: SplitLine[];
}

/** Guests 2, 3, … as new bills. Ids are minted here, once, so the screen, the
 *  exe's copy and the server all name the same rows. */
export function splitRequest(parts: SplitPart[], newId: () => string = () => crypto.randomUUID()): SplitRequestPart[] {
  return parts
    .filter(p => p.guest !== 1 && p.items.length > 0)
    .map(p => ({
      orderId: newId(),
      lines: p.items.filter(oi => oi.id).map(oi => ({ id: oi.id!, quantity: oi.quantity, newId: newId() })),
    }));
}

/** A request from outside, checked; null when it is not one. */
export function cleanSplitParts(raw: unknown): SplitRequestPart[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: SplitRequestPart[] = [];
  for (const p of raw as Record<string, unknown>[]) {
    if (!p || typeof p.orderId !== 'string' || !p.orderId || !Array.isArray(p.lines) || p.lines.length === 0) return null;
    const lines: SplitLine[] = [];
    for (const l of p.lines as Record<string, unknown>[]) {
      if (!l || typeof l.id !== 'string' || typeof l.newId !== 'string'
          || typeof l.quantity !== 'number' || !Number.isInteger(l.quantity) || l.quantity <= 0) return null;
      lines.push({ id: l.id, quantity: l.quantity, newId: l.newId });
    }
    const n = typeof p.orderNumber === 'number' && Number.isInteger(p.orderNumber) ? p.orderNumber : undefined;
    const t = typeof p.tillNumber === 'number' && Number.isInteger(p.tillNumber) ? p.tillNumber : undefined;
    out.push({ orderId: p.orderId, ...(n !== undefined ? { orderNumber: n } : {}), ...(t !== undefined ? { tillNumber: t } : {}), lines });
  }
  return out;
}

/**
 * The split applied to an order: what the original keeps, and each new bill.
 * The same rules as split_order(), for the exe's copy and the tests. Null when
 * the split would empty the original or names nothing on it.
 */
export function applySplit(
  order: Order,
  request: SplitRequestPart[],
): { original: Order; created: Order[] } | null {
  let items = order.items.map(oi => ({ ...oi }));
  const created: Order[] = [];
  for (const part of request) {
    const taken: OrderItem[] = [];
    for (const l of part.lines) {
      const line = items.find(oi => oi.id === l.id);
      if (!line || l.quantity <= 0) continue;
      if (l.quantity >= line.quantity) {
        items = items.filter(oi => oi !== line);
        taken.push(line);
      } else {
        line.quantity -= l.quantity;
        taken.push({ ...line, id: l.newId, quantity: l.quantity });
      }
    }
    // Nothing of it is still on the bill: no empty bill, as split_order() skips it.
    if (taken.length === 0) continue;
    created.push({
      ...order,
      id: part.orderId,
      orderNumber: part.orderNumber ?? 0,   // 0: the server numbers it
      tillNumber: part.orderNumber !== undefined ? part.tillNumber : undefined,
      items: taken,
      removedItems: [],
      note: undefined,
      billPrintedAt: undefined,
      courierId: undefined,
      online: false,
    });
  }
  if (items.length === 0 || created.every(c => c.items.length === 0)) return null;
  return { original: { ...order, items }, created };
}

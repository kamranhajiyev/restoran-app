import type { CourierPendingOrder } from '@/types';

type Row = {
  id: string;
  order_number: number | null;
  created_at: string;
  courier_id: string | null;
  courier_debt: number | string | null;
  courier_cash: number | string | null;
  courier_card: number | string | null;
};

/**
 * Each courier's deliveries whose money has not all come back, oldest first.
 *
 * Shared by /api/public-couriers and the logged-in read in lib/store.ts so the
 * two tills cannot list different orders. Rows must already be 'ödənilib' —
 * nothing else owes.
 */
export function courierPending(rows: Row[]): Record<string, CourierPendingOrder[]> {
  const out: Record<string, CourierPendingOrder[]> = {};
  for (const o of rows) {
    if (!o.courier_id) continue;
    const owed = Number(o.courier_debt ?? 0) - Number(o.courier_cash ?? 0) - Number(o.courier_card ?? 0);
    if (owed <= 0.005) continue;
    (out[o.courier_id] ??= []).push({
      id: o.id,
      orderNumber: o.order_number ?? 0,
      createdAt: o.created_at,
      owed: Math.round(owed * 100) / 100,
    });
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return out;
}

/** What is still out on an order, as the till has it. */
export function courierOwed(o: { courierDebt?: number; courierCash?: number; courierCard?: number }): number {
  return Math.max(0, (o.courierDebt ?? 0) - (o.courierCash ?? 0) - (o.courierCard ?? 0));
}

/**
 * The kassa's shift sales.
 *  cash        — paid in cash at the counter
 *  card        — everything that went through the bank terminal, riders'
 *                card settlements included (what the Terminal check compares)
 *  courierCard — the riders' part of `card`: settlements, possibly for an
 *                earlier shift's deliveries, so not this shift's sales
 *  courierSales— this shift's deliveries closed on a rider, paid back or not
 *  courier     — the part of courierSales the riders still hold
 */
export type ShiftSales = { cash: number; card: number; courierCard: number; courierSales: number; courier: number };

/** This shift's deliveries closed on a rider, whether he has paid them back or not. */
export function courierSold(rows: { courier_debt?: number | string | null }[]): number {
  return Math.round(rows.reduce((s, o) => s + Number(o.courier_debt ?? 0), 0) * 100) / 100;
}

/**
 * What riders still hold for these paid orders, as the server rows have it.
 *
 * The Kassa's "Ümumi satış" left it out, so a shift with 30 ₼ on a courier read
 * 30 short of Tarixçə until the rider paid (Latte Art, 2026-10-05). Once he
 * pays, it leaves this figure and arrives in the cash — the total stays put.
 */
export function courierStillOut(
  rows: { courier_debt?: number | string | null; courier_cash?: number | string | null; courier_card?: number | string | null }[],
): number {
  const sum = rows.reduce((s, o) => s + Math.max(0,
    Number(o.courier_debt ?? 0) - Number(o.courier_cash ?? 0) - Number(o.courier_card ?? 0)), 0);
  return Math.round(sum * 100) / 100;
}

/**
 * The Kassa's "sales" box: what this shift sold, each sale once.
 *
 * Latte Art, 2026-10-05: a delivery closed on a rider in shift 1 was counted in
 * shift 1's sales, and again in shift 2's when the rider paid it back there —
 * the settlement went into Nağd (or Kart) satış. A settlement is money arriving
 * in the drawer, not a sale; the drawer count still includes it, the sales
 * total no longer does. Courier sales are this shift's deliveries, paid back
 * or not.
 *
 * `courierCashIn` is the shift's 'Kuryer ödənişi' movements — used only for an
 * older exe's answer, which has no courierSales and keeps its old sum.
 */
export function kassaSales(
  s: { cash: number; card: number; courierCard?: number; courierSales?: number; courier?: number },
  courierCashIn: number,
): { nagd: number; kart: number; kuryer: number; kuryerOut: number; total: number } {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  if (s.courierSales === undefined) {
    const kuryer = s.courier ?? 0;
    return { nagd: r2(s.cash + courierCashIn), kart: r2(s.card), kuryer, kuryerOut: kuryer, total: r2(s.cash + courierCashIn + s.card + kuryer) };
  }
  const kart = r2(s.card - (s.courierCard ?? 0));
  return { nagd: r2(s.cash), kart, kuryer: s.courierSales, kuryerOut: s.courier ?? 0, total: r2(s.cash + kart + s.courierSales) };
}

/** What couriers handed over in a window: the money by road, and the orders
 *  those payments named — so Tarixçə can tell a delivery paid back inside a
 *  shift from one paid in a later one. */
export type Collections = { nagd: number; kart: number; paidOrderIds?: string[] };

export function sumCollections(
  rows: { amount: unknown; method: string | null; order_ids?: string[] | null }[],
): Collections {
  const ids = new Set<string>();
  const acc = { nagd: 0, kart: 0 };
  for (const p of rows) {
    if (p.method === 'kart') acc.kart += Number(p.amount ?? 0);
    else acc.nagd += Number(p.amount ?? 0);
    for (const id of p.order_ids ?? []) ids.add(id);
  }
  return { ...acc, paidOrderIds: [...ids] };
}

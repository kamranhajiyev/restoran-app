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

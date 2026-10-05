// What may be done to an order, written once.
//
// The same rules used to live in three places: the site's routes (the linked
// browser till), lib/store.ts (the signed-in browser) and electron/till-write.ts
// (the exe). Each copy drifted on its own. Test Restoran, 2026-10-05: the site
// let a menu-link order get its first courier, the exe still refused it, and the
// seller tapped a rider that never took. The copies also disagreed on whether a
// deleted order could be cancelled and whether a paid one could change status.
//
// Each write asks `refusal` (exe and routes that read the order first) or
// applies `guardQuery` (conditional UPDATEs on Supabase). Both come from the
// table below, and tests/order-rules.test.ts checks that they always agree.

// Relative, not '@/types': the exe compiles this file with plain tsc, which
// does not know the alias.
import type { OrderStatus } from '../types';

export type OrderAction =
  | 'edit'     // add, change or remove dishes
  | 'move'     // another table
  | 'courier'  // give the order a rider, or a different one
  | 'cancel'   // "Ödənişsiz bağla"
  | 'status';  // pay it, or move it along

const CLOSED: readonly OrderStatus[] = ['ödənilib', 'ləğv edildi', 'silinib'];

/** The statuses that refuse each action. */
export const BLOCKED_BY: Record<OrderAction, readonly OrderStatus[]> = {
  edit: CLOSED,
  move: CLOSED,
  courier: CLOSED,
  cancel: CLOSED,
  // Paid and cancelled are final — that guard is what stops a second tap
  // charging the guest twice. A deleted order is brought back by restoreOrder,
  // not through here, but is not refused here either.
  status: ['ödənilib', 'ləğv edildi'],
};

/**
 * A courier can be given to an order that already has one, or to a menu-link
 * order — a delivery waiting for its first rider. Not to a takeaway: nothing
 * is being carried anywhere. Same rule as COURIER_FILTER.
 */
export function canTakeCourier(o: { courierId?: string | null; online?: boolean | null }): boolean {
  return !!o.courierId || !!o.online;
}

/** The PostgREST `.or()` filter for canTakeCourier. */
export const COURIER_FILTER = 'courier_id.not.is.null,online.is.true';

/** Why the action is refused, or null when it may go ahead. */
export function refusal(
  action: OrderAction,
  o: { status: OrderStatus; courierId?: string | null; online?: boolean | null },
): 'closed' | 'not_courier' | null {
  if (BLOCKED_BY[action].includes(o.status)) return 'closed';
  if (action === 'courier' && !canTakeCourier(o)) return 'not_courier';
  return null;
}

/** The part of a Supabase query this needs: neq and or, each returning the query. */
export interface Guardable<Q> {
  neq(column: string, value: string): Q;
  or(filter: string): Q;
}

/**
 * Narrow a conditional UPDATE to the orders the action is allowed on, so the
 * database refuses exactly what `refusal` refuses — in the same statement as
 * the write, with no window for the order to change in between.
 */
export function guardQuery<Q extends Guardable<Q>>(q: Q, action: OrderAction): Q {
  let out = q;
  for (const s of BLOCKED_BY[action]) out = out.neq('status', s);
  if (action === 'courier') out = out.or(COURIER_FILTER);
  return out;
}

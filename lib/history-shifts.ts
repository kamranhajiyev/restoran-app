// Tarixçə by kassa shift.
//
// Latte Art, 2026-10-05: to check the first shift the owner opened receipts
// №153–№250 one by one and added up cash, card and what the courier still had.
// Picking the shift does that sum for them.

import { courierOwed } from './courier-pending';

export type HistoryShift = { id: string; openedAt: string; openedBy: string; closedAt?: string };

/**
 * The shifts that ran during today's business day, first one first — the order
 * the staff count them in ("Smen 1", "Smen 2"). A shift opened last night and
 * still running counts: its orders are in today's list.
 */
export function shiftsOfDay<T extends HistoryShift>(shifts: T[], dayStart: string, now: string): T[] {
  const start = Date.parse(dayStart);
  const end = Date.parse(now);
  return shifts
    .filter(s => Date.parse(s.openedAt) <= end && (!s.closedAt || Date.parse(s.closedAt) >= start))
    .sort((a, b) => a.openedAt.localeCompare(b.openedAt));
}

/**
 * The orders to load for a shift: the ones opened while it ran. That is the
 * receipt-number range the staff think of the shift as, and the same rule the
 * day view uses — an order counts where it was opened.
 */
export function shiftWindow(shift: HistoryShift, now: string): { from: string; to: string } {
  return { from: shift.openedAt, to: shift.closedAt ?? now };
}

/**
 * Money the riders still have for these orders — the part of Cəmi that is in
 * neither Nağd nor Kart yet, so the boxes add up.
 */
export function courierOutstanding(
  orders: { status: string; courierDebt?: number; courierCash?: number; courierCard?: number }[],
): number {
  return orders.reduce((s, o) => s + (o.status === 'ödənilib' ? courierOwed(o) : 0), 0);
}

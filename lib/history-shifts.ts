// Tarixçə by kassa shift.
//
// Latte Art, 2026-10-05: to check the first shift the owner opened receipts
// №153–№250 one by one and added up cash, card and what the courier still had.
// Picking the shift does that sum for them.

import { isOrderOpen, type OrderStatus } from '@/types';
import { courierOwed } from './courier-pending';

export type HistoryShift = { id: string; openedAt: string; openedBy: string; closedAt?: string };

/**
 * The shifts that ran during today's business day, first one first — the order
 * the staff count them in ("Növbə 1", "Növbə 2"). A shift opened last night and
 * still running counts: its orders are in today's list.
 */
export function shiftsOfDay<T extends HistoryShift>(shifts: T[], dayStart: string, now: string): T[] {
  const start = Date.parse(dayStart);
  const end = Date.parse(now);
  return shifts
    .filter(s => Date.parse(s.openedAt) <= end && (!s.closedAt || Date.parse(s.closedAt) >= start))
    .sort((a, b) => a.openedAt.localeCompare(b.openedAt));
}

/** When the shift ran: from its opening to its close, or to now while open. */
export function shiftWindow(shift: HistoryShift, now: string): { from: string; to: string } {
  return { from: shift.openedAt, to: shift.closedAt ?? now };
}

// How far back an order can have been opened and still be paid in this shift.
// A table left open by the morning cashier and settled by the evening one is
// the case; a day covers it.
export const SHIFT_LOOKBACK_MS = 24 * 60 * 60_000;

/** The orders to fetch for a shift: its window, reaching back a day for orders opened earlier. */
export function shiftLoadWindow(shift: HistoryShift, now: string): { from: string; to: string } {
  const w = shiftWindow(shift, now);
  return { from: new Date(Date.parse(w.from) - SHIFT_LOOKBACK_MS).toISOString(), to: w.to };
}

/**
 * The shift's orders: the ones it closed — paid or cancelled while it ran —
 * wherever they were opened. Latte Art, 2026-10-05: the morning cashier left
 * orders open, the evening one took the money, and Tarixçə put them in the
 * morning shift while Kassa (which counts by payment) put them in the evening,
 * so the two screens disagreed. The cashier who takes the money answers for
 * it. Orders still open belong to the shift still running.
 */
export function ordersOfShift<T extends { status: OrderStatus; createdAt: string; paidAt?: string; cancelledAt?: string }>(
  orders: T[], shift: HistoryShift, now: string,
): T[] {
  const { from, to } = shiftWindow(shift, now);
  return orders.filter(o => {
    // A deleted order carries no closing time; it stays where it was opened.
    const at = o.paidAt ?? o.cancelledAt ?? (isOrderOpen(o) ? null : o.createdAt);
    if (at === null) return !shift.closedAt;
    // Half-open: an order paid the moment one shift closes and the next opens
    // belongs to one of them, not both.
    return at >= from && (shift.closedAt ? at < to : true);
  });
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

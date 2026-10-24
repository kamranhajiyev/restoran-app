// How soon coming back to the till may re-read the server again.
//
// The browser till link re-read everything (menu, categories, tables, staff,
// readiness, modifiers, couriers, orders, the link itself) on every window focus
// and again on every visibilitychange, which fire together. Switching back and
// forth between windows sent nine requests a time, often twice, and the orders
// reads queued behind each other for up to eleven seconds (2026-10-23). Once per
// half minute is still "fresh when you look", and new orders arrive on the
// restaurant's signal anyway.
export const FOCUS_REFRESH_MS = 30_000;

/** Whether a focus or visibility event should re-read, given the last read. */
export function focusRefreshDue(lastRun: number, now: number): boolean {
  return now - lastRun >= FOCUS_REFRESH_MS;
}

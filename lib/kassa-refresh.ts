// Admin's Kassa tab re-downloaded the open shift (up to 1000 orders, courier
// payments and the sales sums) every 30 s, around the clock, even with nothing
// sold and the tab in the background. Now an order change brings the news and
// the timer is only a safety net for what has no realtime of its own (courier
// payments) or a socket that died.

/** How often the timer wakes up to ask whether a refresh is due. */
export const KASSA_TICK_MS = 30_000;

/**
 * How long order changes are gathered before one re-download. A rush makes a
 * change every few seconds; this keeps it at the old 30 s at most, and at none
 * while nothing is sold.
 */
export const KASSA_GATHER_MS = 30_000;

/** How long the safety net waits while the realtime socket is up. */
export const KASSA_SAFETY_NET_MS = 5 * 60_000;

/** Whether a timer tick should re-download the open shift. Never for a hidden tab. */
export function kassaTickDue(s: { lastRun: number; now: number; realtimeUp: boolean; visible: boolean }): boolean {
  return s.visible && (!s.realtimeUp || s.now - s.lastRun >= KASSA_SAFETY_NET_MS);
}

// One refresh for a burst of changes.
//
// 2026-10-07: admin and the browser till re-downloaded the last 200 orders with
// every dish on each realtime change. One sale is several changes (the order,
// its dishes, its payment), so ten downloads went out together; it was most of
// the month's egress, and the bursts timed out against each other.

/**
 * Returns a trigger. The first call starts a wait of `ms`; calls during the
 * wait join it; `fn` runs once at the end. So news is never more than `ms` late.
 */
export function coalesce(fn: () => void, ms: number): (() => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const trigger = () => {
    if (timer) return;
    timer = setTimeout(() => { timer = null; fn(); }, ms);
  };
  return Object.assign(trigger, {
    cancel: () => { if (timer) clearTimeout(timer); timer = null; },
  });
}

/** How long a burst of realtime changes is gathered before one refresh. */
export const REFRESH_GATHER_MS = 1_500;

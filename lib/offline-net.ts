// Is the line actually up, and where a write goes when it is not.
//
// navigator.onLine is not the question. It answers "is there a network
// interface", which on a restaurant's wifi is still true when the router has
// lost its uplink, and is famously wrong on iOS. So the state here is driven by
// whether our own requests are getting through, with the browser events used
// only as a hint to re-check sooner.

import { enqueue } from "./offline-queue";

type Listener = (online: boolean) => void;

let _online = true;
const _listeners = new Set<Listener>();

export function isOnline(): boolean {
  return _online;
}

export function onConnectivityChange(fn: Listener): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function setOnline(next: boolean): void {
  if (next === _online) return;
  _online = next;
  for (const fn of _listeners) fn(next);
}

/** A cheap request that proves the uplink, not just the wifi. */
async function probe(): Promise<boolean> {
  try {
    const res = await fetch("/api/health", {
      method: "HEAD",
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

let _probing = false;

export async function checkConnectivity(): Promise<boolean> {
  if (_probing) return _online;
  _probing = true;
  try {
    const up = await probe();
    setOnline(up);
    return up;
  } finally {
    _probing = false;
  }
}

/**
 * Start watching the connection. Polls slowly while up — the point is to notice
 * a dropout within a few seconds, not to generate traffic — and quickly while
 * down, because a waiter is standing there waiting to take payment.
 */
export function startConnectivityWatch(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async () => {
    await checkConnectivity();
    timer = setTimeout(tick, _online ? 20_000 : 5_000);
  };

  const hint = () => void checkConnectivity();
  window.addEventListener("online", hint);
  window.addEventListener("offline", hint);
  // Coming back from a locked screen is the other moment the answer has changed.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") hint();
  });

  void tick();

  return () => {
    if (timer) clearTimeout(timer);
    window.removeEventListener("online", hint);
    window.removeEventListener("offline", hint);
  };
}

export type WriteResult = {
  ok: boolean;
  /** True when the write is parked in IndexedDB rather than applied. */
  queued: boolean;
};

/**
 * Send a till write, or park it until the line is back.
 *
 * `id` is the idempotency key: stable for a given logical write, so that a
 * retry after a lost reply is recognised by the server instead of applied
 * twice. Callers generate it once, with the order or payment it belongs to.
 */
export async function postOrQueue(
  id: string,
  route: string,
  body: Record<string, unknown>,
  companyId: string | null,
): Promise<WriteResult> {
  if (_online) {
    try {
      const res = await fetch(route, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": id },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({ ok: res.ok }));
      if (res.ok && data.ok !== false) return { ok: true, queued: false };
      // A refusal is an answer — the server is reachable and said no. Queuing it
      // would only replay the same rejection later.
      if (res.status >= 400 && res.status < 500) return { ok: false, queued: false };
    } catch {
      // Fell through to the queue: the request never landed.
      setOnline(false);
    }
  }

  await enqueue(id, route, body, companyId);
  return { ok: true, queued: true };
}

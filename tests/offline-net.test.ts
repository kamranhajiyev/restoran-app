// A write must never overtake one queued before it.
//
// Latte Art №4171/№4172, 2026-10-04: the order went into the browser's queue
// while the line was down, the line came back, and the payment went straight
// to the server — which had never seen the order, refused, and the order could
// not be paid.

// The whole IndexedDB family (IDBRequest, IDBKeyRange…), which idb relies on.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ADD_ORDER = "supabase:addOrder";

// Fresh modules and a fresh IndexedDB per test: the queue keeps its state in
// module variables, and one test's leftovers must not decide the next.
async function load() {
  vi.resetModules();
  globalThis.indexedDB = new IDBFactory();
  const queue = await import("@/lib/offline-queue");
  const net = await import("@/lib/offline-net");
  return { queue, net };
}

function okFetch() {
  return vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
}

describe("postOrQueue", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("sends straight to the server when nothing is waiting", async () => {
    const { queue, net } = await load();
    const fetch = okFetch();
    vi.stubGlobal("fetch", fetch);

    const res = await net.postOrQueue("pay:A", "/api/update-order-status", { orderId: "A" }, "c1");

    expect(res).toEqual({ ok: true, queued: false });
    expect(fetch).toHaveBeenCalledOnce();
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("pay:A");
    expect(await queue.queueSize()).toBe(0);
  });

  it("puts a payment behind its order when the order is still queued", async () => {
    const { queue, net } = await load();
    const fetch = okFetch();
    vi.stubGlobal("fetch", fetch);

    // The line was down when the order was made, so it was parked.
    await queue.enqueue("order:A", ADD_ORDER, { id: "A" }, "c1");

    // The line is back, and the waiter presses Ödəniş.
    const res = await net.postOrQueue("pay:A", "/api/update-order-status", { orderId: "A" }, "c1");

    expect(fetch).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: true, queued: true });
    const ids = (await queue.getAllQueued()).map(e => e.id);
    expect(ids).toEqual(["order:A", "pay:A"]);
  });

  it("asks for the queue to be sent when a write is parked", async () => {
    const { queue } = await load();
    const sent = vi.fn();
    queue.onEnqueue(sent);

    await queue.enqueue("order:A", ADD_ORDER, { id: "A" }, "c1");

    expect(sent).toHaveBeenCalledOnce();
  });

  it("parks a write when the line drops mid-request", async () => {
    const { queue, net } = await load();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));

    const res = await net.postOrQueue("pay:A", "/api/update-order-status", { orderId: "A" }, "c1");

    expect(res).toEqual({ ok: true, queued: true });
    expect((await queue.getAllQueued()).map(e => e.id)).toEqual(["pay:A"]);
  });
});

// The desktop till (exe): every write lands in SQLite on the machine first, and
// an outbox carries it to the server later. These tests run the real exe code
// against a real SQLite file in a temporary folder — no Electron, no window.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "@/types";

const C = "company-1";
const PAY = "/api/update-order-status";

let dir: string;
let till: typeof import("@/electron/till-write");
let repo: typeof import("@/electron/till-repo");

// Fresh modules each time: electron/db.ts keeps its open handle in a module
// variable, so reloading the modules is what "restarting the exe" looks like.
async function start(folder: string) {
  vi.resetModules();
  (await import("@/electron/db")).openDb(folder);
  till = await import("@/electron/till-write");
  repo = await import("@/electron/till-repo");
}

function order(id: string): Order {
  return {
    id,
    status: "gözləyir",
    createdAt: new Date().toISOString(),
    items: [{ menuItem: { id: "m1", name: "Americano", price: 4.5 }, quantity: 1 }],
  } as unknown as Order;
}

const newOrder = (id: string, company = C) => till.applyWrite(`order:${id}`, till.ADD_ORDER, order(id) as never, company);
const pay = (id: string, key = `pay:${id}`, company = C) =>
  till.applyWrite(key, PAY, { orderId: id, status: "ödənilib", cashAmount: 4.5 }, company);
const outboxIds = () => till.outboxAll().map(e => e.id);

describe("exe till", () => {
  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "till-"));
    await start(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("sends an order made offline before its payment", () => {
    expect(newOrder("A")).toEqual({ ok: true });
    expect(pay("A")).toEqual({ ok: true });

    expect(outboxIds()).toEqual(["order:A", "pay:A"]);
    expect(repo.getOrder("A")?.status).toBe("ödənilib");
  });

  it("charges once when Ödəniş is pressed twice", () => {
    newOrder("A");
    pay("A");
    pay("A");

    expect(outboxIds().filter(id => id === "pay:A")).toHaveLength(1);
  });

  it("refuses to pay an order that is already paid", () => {
    newOrder("A");
    pay("A");

    expect(pay("A", "pay:A-again")).toEqual({ ok: false, error: "closed" });
    expect(outboxIds()).toEqual(["order:A", "pay:A"]);
  });

  it("refuses to pay a cancelled order", () => {
    newOrder("A");
    till.applyWrite("cancel:A", "/api/cancel-order", { orderId: "A", reason: "test", by: "E2E" }, C);

    expect(pay("A")).toEqual({ ok: false, error: "closed" });
  });

  it("refuses a payment for an order it does not have, and queues nothing", () => {
    expect(pay("X")).toEqual({ ok: false, error: "not_found" });
    expect(till.outboxCount()).toBe(0);
  });

  it("keeps everything waiting to be sent when the till restarts", async () => {
    newOrder("A");
    pay("A");

    await start(dir);

    expect(outboxIds()).toEqual(["order:A", "pay:A"]);
    expect(repo.getOrder("A")?.status).toBe("ödənilib");
  });

  it("does not let one restaurant pay another's order", () => {
    newOrder("A");

    expect(pay("A", "pay:A", "company-2")).toEqual({ ok: false, error: "not_found" });
    expect(repo.getOrder("A")?.status).toBe("gözləyir");
  });
});

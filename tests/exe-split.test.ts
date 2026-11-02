// "Hesabı böl" on the exe and the APK: the split lands on the machine's own copy
// first, numbers the new bills itself, and the outbox carries one write that
// the server's split_order() repeats exactly. Real exe code, real SQLite file.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "@/types";

const C = "company-1";

let dir: string;
let till: typeof import("@/lib/till-store/write");
let repo: typeof import("@/lib/till-store/repo");

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "till-split-"));
  vi.resetModules();
  (await import("@/electron/db")).openDb(dir);
  till = await import("@/lib/till-store/write");
  repo = await import("@/lib/till-store/repo");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function table2(): Order {
  return {
    id: "A",
    tableNumber: 2,
    status: "gözləyir",
    createdAt: new Date().toISOString(),
    items: [
      { id: "cap", menuItem: { id: "m1", name: "Capucino", price: 3 }, quantity: 4 },
      { id: "cro", menuItem: { id: "m2", name: "Croissant", price: 4 }, quantity: 1 },
    ],
  } as unknown as Order;
}

const split = (key = "split:A") =>
  till.applyWrite(key, "/api/split-order", {
    orderId: "A",
    parts: [{ orderId: "B", lines: [{ id: "cap", quantity: 2, newId: "cap-b" }, { id: "cro", quantity: 1, newId: "x" }] }],
  }, C);

const total = (o?: Order) => (o?.items ?? []).reduce((s, oi) => s + oi.menuItem.price * oi.quantity, 0);

describe("exe split", () => {
  it("moves guest 2's share to a new bill on the same table", () => {
    till.applyWrite("order:A", till.ADD_ORDER, table2() as never, C);
    expect(split()).toEqual({ ok: true });

    const a = repo.getOrder("A")!;
    const b = repo.getOrder("B")!;
    expect(a.items.map(oi => [oi.id, oi.quantity])).toEqual([["cap", 2]]);
    expect(b.items.map(oi => [oi.id, oi.quantity])).toEqual([["cap-b", 2], ["cro", 1]]);
    expect(b.tableNumber).toBe(2);
    expect(total(a) + total(b)).toBe(16);
  });

  it("numbers the new bill after the till's own, and sends that number", () => {
    till.applyWrite("order:A", till.ADD_ORDER, table2() as never, C);
    split();
    const a = repo.getOrder("A")!;
    const b = repo.getOrder("B")!;
    expect(b.orderNumber).toBe(a.orderNumber + 1);

    const sent = till.outboxAll().find(e => e.kind === "/api/split-order")!;
    expect((sent.body as { parts: { orderNumber: number }[] }).parts[0].orderNumber).toBe(b.orderNumber);
  });

  it("splits once when Böl is pressed twice", () => {
    till.applyWrite("order:A", till.ADD_ORDER, table2() as never, C);
    split();
    split();
    expect(till.outboxAll().filter(e => e.kind === "/api/split-order")).toHaveLength(1);
    expect(repo.getOrder("A")!.items[0].quantity).toBe(2);
  });

  it("refuses to empty the original bill", () => {
    till.applyWrite("order:A", till.ADD_ORDER, table2() as never, C);
    const r = till.applyWrite("split:all", "/api/split-order", {
      orderId: "A",
      parts: [{ orderId: "B", lines: [{ id: "cap", quantity: 4, newId: "y" }, { id: "cro", quantity: 1, newId: "z" }] }],
    }, C);
    expect(r.ok).toBe(false);
    expect(repo.getOrder("B")).toBeFalsy();
  });

  it("refuses a paid order", () => {
    till.applyWrite("order:A", till.ADD_ORDER, table2() as never, C);
    till.applyWrite("pay:A", "/api/update-order-status", { orderId: "A", status: "ödənilib", cashAmount: 16 }, C);
    expect(split().ok).toBe(false);
  });
});

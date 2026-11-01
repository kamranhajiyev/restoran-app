// 2026-11-01: the exe's and the phone's own database (lib/till-store) had tests
// for taking and paying an order, but none for what happens between and after:
// a quantity lowered, a dish taken off, a cancel, a table move, and the shift's
// drawer. Offline, these land here first and the server hears later, so a
// mistake here is the bill and the drawer the waiter sees. Same real SQLite as
// exe-till.test.ts; totals through the functions every screen uses.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { orderTotal } from "@/components/seller/order-format";
import { expectedCash } from "@/lib/shift-cash";
import type { Order } from "@/types";

const C = "company-1";
const OTHER = "company-2";

let dir: string;
let till: typeof import("@/lib/till-store/write");
let repo: typeof import("@/lib/till-store/repo");

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "till-money-"));
  vi.resetModules();
  (await import("@/electron/db")).openDb(dir);
  till = await import("@/lib/till-store/write");
  repo = await import("@/lib/till-store/repo");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** 3 plov at 6.50 and 2 tea at 1.00: 21.50. */
function takeOrder(id = "A", company = C) {
  const order = {
    id, status: "gözləyir", createdAt: new Date().toISOString(), tableNumber: 0,
    items: [
      { id: `${id}-plov`, menuItem: { id: "m1", name: "Plov", price: 6.5 }, quantity: 3 },
      { id: `${id}-tea`, menuItem: { id: "m2", name: "Çay", price: 1 }, quantity: 2 },
    ],
  } as unknown as Order;
  return till.applyWrite(`order:${id}`, till.ADD_ORDER, order as never, company);
}

const write = (key: string, kind: string, body: Record<string, unknown>, company = C) =>
  till.applyWrite(key, kind, body, company);
const bill = (id = "A") => orderTotal(repo.getOrder(id)!);
const struck = (id = "A") => (repo.getOrder(id)!.removedItems ?? []).map(i => `${i.quantity} ${i.menuItem.name}`);

describe("the offline till's bill", () => {
  it("lowers a quantity once, even when pressed twice, and strikes through what was taken", () => {
    takeOrder();
    const body = { orderId: "A", orderItemId: "A-plov", quantity: 2 };
    expect(write("qty:1", "/api/update-order-item-qty", body)).toEqual({ ok: true });
    expect(write("qty:1", "/api/update-order-item-qty", body)).toEqual({ ok: true });
    expect(bill()).toBe(15);
    expect(struck()).toEqual(["1 Plov"]);
  });

  it("takes several dishes off in one go, as one message to the server", () => {
    takeOrder();
    const before = till.outboxCount();
    const lines = [{ orderItemId: "A-tea", quantity: 0 }, { orderItemId: "A-plov", quantity: 1, ghostId: "g1" }];
    expect(write("rm:1", "/api/remove-order-items", { orderId: "A", lines })).toEqual({ ok: true });
    expect(write("rm:1", "/api/remove-order-items", { orderId: "A", lines })).toEqual({ ok: true });
    expect(bill()).toBe(6.5);
    expect(struck().sort()).toEqual(["2 Plov", "2 Çay"]);
    expect(till.outboxCount()).toBe(before + 1);
  });

  it("takes a whole dish off", () => {
    takeOrder();
    expect(write("rm:tea", "/api/remove-order-item", { orderId: "A", orderItemId: "A-tea" })).toEqual({ ok: true });
    expect(bill()).toBe(19.5);
  });

  it("does not change a paid bill", () => {
    takeOrder();
    write("pay:A", "/api/update-order-status", { orderId: "A", status: "ödənilib", cashAmount: 21.5 });
    expect(write("qty:2", "/api/update-order-item-qty", { orderId: "A", orderItemId: "A-plov", quantity: 1 }).ok).toBe(false);
    expect(write("rm:2", "/api/remove-order-items", { orderId: "A", lines: [{ orderItemId: "A-tea", quantity: 0 }] }).ok).toBe(false);
    expect(write("cancel:A", "/api/cancel-order", { orderId: "A", reason: "x", by: "x" }).ok).toBe(false);
    expect(bill()).toBe(21.5);
  });

  it("cancels an open order, which then cannot be paid", () => {
    takeOrder();
    expect(write("cancel:A", "/api/cancel-order", { orderId: "A", reason: "Qonaq getdi", by: "Aysel" })).toEqual({ ok: true });
    expect(repo.getOrder("A")!.status).toBe("ləğv edildi");
    expect(write("pay:A", "/api/update-order-status", { orderId: "A", status: "ödənilib", cashAmount: 21.5 }).ok).toBe(false);
  });

  it("moves an order to one of this restaurant's tables, with its bill", () => {
    repo.replaceReference("tables", C, [{ id: 7, name: "Masa 7" }]);
    repo.replaceReference("tables", OTHER, [{ id: 9, name: "Masa 9" }]);
    takeOrder();
    expect(write("move:1", "/api/move-table", { orderId: "A", tableId: 9 })).toEqual({ ok: false, error: "table" });
    expect(write("move:2", "/api/move-table", { orderId: "A", tableId: 7 })).toEqual({ ok: true });
    expect(repo.getOrder("A")!.tableNumber).toBe(7);
    expect(bill()).toBe(21.5);
  });

  it("does not let one restaurant change another's order", () => {
    takeOrder();
    expect(write("qty:x", "/api/update-order-item-qty", { orderId: "A", orderItemId: "A-plov", quantity: 0 }, OTHER).ok).toBe(false);
    expect(bill()).toBe(21.5);
  });
});

describe("the offline till's drawer", () => {
  const open = (shiftId = "S1", key = "open:S1") =>
    write(key, "/api/open-shift", { shiftId, openedBy: "Aysel", openingCash: 50, openedAt: new Date(Date.now() - 1000).toISOString() });
  const move = (key: string, amount: number, id = key) =>
    write(key, "/api/add-shift-movement", { shiftId: "S1", movement: { id, at: new Date().toISOString(), amount, reason: "x", by: "Aysel" } });

  it("opens one shift; a second one is refused while it is open", () => {
    expect(open()).toEqual({ ok: true });
    expect(open("S2", "open:S2")).toEqual({ ok: false, error: "already_open" });
    expect(repo.getOpenShift(C)!.openingCash).toBe(50);
  });

  it("books money in and out once each, even when sent twice", () => {
    open();
    move("in:1", 20);
    move("in:1", 20);
    move("out:1", -5);
    // A replay under a new key still carries the movement's own id.
    move("in:1-again", 20, "in:1");
    expect(repo.getOpenShift(C)!.movements.map(m => m.amount)).toEqual([20, -5]);
  });

  it("should hold opening cash + cash sales + movements, card apart: 50 + 13 + 20 − 5 = 78", () => {
    open();
    takeOrder("A");
    write("rm:A", "/api/remove-order-items", { orderId: "A", lines: [{ orderItemId: "A-plov", quantity: 2 }, { orderItemId: "A-tea", quantity: 0 }] });
    write("pay:A", "/api/update-order-status", { orderId: "A", status: "ödənilib", cashAmount: 13, cardAmount: 0 });
    takeOrder("B");
    write("pay:B", "/api/update-order-status", { orderId: "B", status: "ödənilib", cashAmount: 0, cardAmount: 21.5 });
    move("in:1", 20);
    move("out:1", -5);

    const shift = repo.getOpenShift(C)!;
    const sales = repo.getShiftSales(C, shift.openedAt);
    expect(sales).toMatchObject({ cash: 13, card: 21.5 });
    expect(expectedCash(shift, sales.cash)).toBe(78);
  });

  it("closes once, at what was counted, and takes no more money after", () => {
    open();
    move("in:1", 20);
    expect(write("close:S1", "/api/close-shift", { shiftId: "S1", closedBy: "Aysel", expectedCash: 70, countedCash: 70 })).toEqual({ ok: true });
    expect(repo.getOpenShift(C)).toBeNull();
    expect(write("close:S1-again", "/api/close-shift", { shiftId: "S1", closedBy: "x", expectedCash: 70, countedCash: 1 }).ok).toBe(false);
    expect(move("in:2", 10).ok).toBe(false);
  });
});

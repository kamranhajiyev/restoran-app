// Two exes in one restaurant tell each other their highest order number over the
// Wi-Fi, so the second does not print a number the first already used.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "@/types";

const C = "company-1";
let dir: string;
let till: typeof import("@/electron/till-write");
let peers: typeof import("@/electron/till-peers");
let repo: typeof import("@/electron/till-repo");

const order = (id: string) => ({
  id,
  status: "gözləyir",
  createdAt: new Date().toISOString(),
  items: [{ menuItem: { id: "m1", name: "Americano", price: 4.5 }, quantity: 1 }],
}) as unknown as Order;

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "peers-"));
  vi.resetModules();
  (await import("@/electron/db")).openDb(dir);
  till = await import("@/electron/till-write");
  peers = await import("@/electron/till-peers");
  repo = await import("@/electron/till-repo");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("order numbers shared between tills", () => {
  it("the next order goes above what another till said it used", () => {
    till.applyWrite("order:A", till.ADD_ORDER, order("A") as never, C);
    expect(repo.getOrder("A")?.orderNumber).toBe(1);

    peers.hear({ companyId: C, max: 45, till: 2 });
    till.applyWrite("order:B", till.ADD_ORDER, order("B") as never, C);
    expect(repo.getOrder("B")?.orderNumber).toBe(46);
  });

  it("a lower number heard later does not move it back", () => {
    peers.hear({ companyId: C, max: 45, till: 2 });
    peers.hear({ companyId: C, max: 10, till: 3 });
    expect(peers.heardMax(C)).toBe(45);
  });

  it("reads a message from a till with the same link", () => {
    const msg = peers.encodeNews("tok", { companyId: C, max: 45, till: 2 });
    expect(peers.decodeNews("tok", C, msg)).toEqual({ companyId: C, max: 45, till: 2 });
    expect(msg.toString()).not.toContain("tok");
  });

  it("ignores a stranger on the Wi-Fi, another restaurant, and changed numbers", () => {
    const msg = peers.encodeNews("tok", { companyId: C, max: 45, till: 2 });
    expect(peers.decodeNews("other", C, msg)).toBeNull();
    expect(peers.decodeNews("tok", "company-2", msg)).toBeNull();
    const forged = Buffer.from(msg.toString().replace('"n":45', '"n":9999'));
    expect(peers.decodeNews("tok", C, forged)).toBeNull();
    expect(peers.decodeNews("tok", C, Buffer.from("junk"))).toBeNull();
  });
});

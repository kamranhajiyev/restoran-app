// The server must not remember a refused payment.
//
// Latte Art №4171/№4172, 2026-10-04: a payment arrived before its order, was
// refused, and the refusal was saved under the order's key — so every later
// press of Ödəniş was answered from that saved "no" and never tried again.

import { beforeEach, describe, expect, it, vi } from "vitest";

const commit = vi.fn(async () => {});
const release = vi.fn(async () => {});
let updatedRows: { id: string }[] = [];

vi.mock("@/lib/supabase-server", () => ({
  verifySellerToken: async () => true,
  createServerClient: () => ({
    from: () => {
      // Every filter returns the same builder; select() is where it resolves.
      const q: Record<string, unknown> = {};
      for (const m of ["update", "eq", "neq"]) q[m] = () => q;
      q.select = async () => ({ data: updatedRows, error: null });
      return q;
    },
  }),
}));

vi.mock("@/lib/idempotency", () => ({
  idempotencyKey: () => "pay:A",
  claim: async () => ({ applied: false, resumed: false, commit, release }),
}));

const { POST } = await import("@/app/api/update-order-status/route");

function pay() {
  const req = new Request("http://test/api/update-order-status", {
    method: "POST",
    body: JSON.stringify({ orderId: "A", status: "ödənilib", cashAmount: 5, companyId: "c1", token: "t" }),
  });
  return POST(req as never);
}

describe("update-order-status", () => {
  beforeEach(() => {
    commit.mockClear();
    release.mockClear();
  });

  it("remembers a payment that went through", async () => {
    updatedRows = [{ id: "A" }];
    const res = await (await pay()).json();

    expect(res).toEqual({ ok: true });
    expect(commit).toHaveBeenCalledWith({ ok: true });
    expect(release).not.toHaveBeenCalled();
  });

  it("forgets a payment the server could not apply, so the next press retries", async () => {
    // The order is not on the server yet: the update matches nothing.
    updatedRows = [];
    const res = await (await pay()).json();

    expect(res).toEqual({ ok: false });
    expect(commit).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });
});

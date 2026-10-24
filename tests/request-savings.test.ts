// The tills asked the site too often for nothing (usage review, 2026-10-24):
// Vercel past its free CPU, and most Supabase requests coming from the site's
// own routes on the tills' behalf.

import "fake-indexeddb/auto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { DOWN_CHECK_MS, HEALTH_PATH, UP_CHECK_MS } from "@/lib/offline-net";
import { SAFETY_NET_MS, URGENT_SAFETY_NET_MS } from "@/lib/till-signal";
import { rereadAfterSend } from "@/lib/open-reread";

const root = join(__dirname, "..");

describe("the online check", () => {
  it("asks a plain file, so no function runs", () => {
    expect(existsSync(join(root, "public", HEALTH_PATH))).toBe(true);
  });

  it("asks a path the exe and the APK will pass on", () => {
    expect(HEALTH_PATH.startsWith("/api/")).toBe(true);
  });

  it("asks once a minute while the line is up, and quickly while it is down", () => {
    expect(UP_CHECK_MS).toBe(60_000);
    expect(DOWN_CHECK_MS).toBe(5_000);
  });

  it("is asked from one place only", () => {
    for (const file of ["app/seller/page.tsx", "lib/offline-net.ts", "lib/sync.ts"]) {
      expect(readFileSync(join(root, file), "utf8")).not.toMatch(/["'`]\/api\/health["'`]/);
    }
  });
});

describe("the safety-net timers while the signal is up", () => {
  it("wait five minutes for new orders and the shift", () => {
    expect(SAFETY_NET_MS).toBe(5 * 60_000);
  });

  it("wait three minutes for food ready and kitchen tickets", () => {
    expect(URGENT_SAFETY_NET_MS).toBe(3 * 60_000);
    const page = readFileSync(join(root, "app/seller/page.tsx"), "utf8");
    expect(page).toMatch(/lastReadyAt\.current, Date\.now\(\), tillSignalUp\(\), URGENT_SAFETY_NET_MS/);
    const print = readFileSync(join(root, "lib/desktopPrint.ts"), "utf8");
    expect(print).toMatch(/tillSignalUp\(\), URGENT_SAFETY_NET_MS\)/);
  });
});

describe("rereadAfterSend", () => {
  it("skips the browser's second order read on open when nothing was sent", () => {
    expect(rereadAfterSend({ opening: true, localDb: false, sent: 0 })).toBe(false);
  });

  it("re-reads on open when something was sent", () => {
    expect(rereadAfterSend({ opening: true, localDb: false, sent: 2 })).toBe(true);
  });

  it("re-reads after a send that is not the open", () => {
    expect(rereadAfterSend({ opening: false, localDb: false, sent: 0 })).toBe(true);
  });

  it("always re-reads in the exe and the APK, which read their own disk", () => {
    expect(rereadAfterSend({ opening: true, localDb: true, sent: 0 })).toBe(true);
  });
});

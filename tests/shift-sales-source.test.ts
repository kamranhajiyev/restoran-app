// 2026-10-08: the exe counted a shift's Terminal money from its own database,
// which holds only the courier card payments this machine took — with two
// tills it came out short. And the server dropped a failed courier card read
// silently, closing the shift on a Terminal figure short by all of it.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const server = { cash: 100, card: 80, courierCard: 30 };
const machine = { cash: 100, card: 50, courierCard: 0 };

function exe(pending: number) {
  vi.stubGlobal('window', {
    location: { href: 'app://till/seller' },
    posNative: { till: {
      outbox: async () => ({ pending }),
      api: async () => ({ ok: true, status: 200, body: JSON.stringify(server) }),
      shiftSales: async () => machine,
    } },
  });
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('shift sales in the exe', () => {
  it('come from the server when nothing is unsent', async () => {
    exe(0);
    const { tillFetch } = await import('@/lib/till-data');
    const d = await (await tillFetch('/api/public-shift-sales?companyId=c1&openedAt=2026-10-08T08:00:00Z')).json();
    expect(d.card).toBe(80);
  });

  it("come from the machine while it holds unsent sales", async () => {
    exe(2);
    const { tillFetch } = await import('@/lib/till-data');
    const d = await (await tillFetch('/api/public-shift-sales?companyId=c1&openedAt=2026-10-08T08:00:00Z')).json();
    expect(d.card).toBe(50);
  });
});

describe('the server', () => {
  it('fails the read when the courier card part fails', () => {
    expect(readFileSync('app/api/public-shift-sales/route.ts', 'utf8')).toMatch(/if \(courierError \|\| !courierCard\)/);
  });
});

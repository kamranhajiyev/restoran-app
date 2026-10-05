// Orders placed elsewhere reach the desktop till's screen quickly.
//
// Test Restoran, 2026-10-05: a menu-link order printed in the kitchen at once
// but reached the till's screen minutes later — only the five-minute sweep put
// it in the local copy the screen reads.

import { afterEach, describe, expect, it, vi } from 'vitest';

// till-sync pulls in the Supabase client, which needs keys this test has no use for.
vi.mock('@/lib/store', () => ({ setCompanyContext: () => {} }));
vi.mock('@/lib/till-image', () => ({ cacheImages: async () => 0 }));

import { newOrdersSince, pullNewOrders, unseenOrders } from '@/lib/till-sync';

type Row = { id: string; createdAt: string; status?: string };

function fakeTill(local: Row[], server: Row[]) {
  const put: Row[] = [];
  const asked: string[] = [];
  const till = {
    orders: async (_c: string, opts: { from?: string; limit?: number }) => {
      const rows = local
        .filter(o => !opts.from || o.createdAt >= opts.from)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, opts.limit ?? 200);
      return { orders: rows, total: rows.length };
    },
    api: async (path: string) => {
      asked.push(path);
      const from = new URL(path, 'http://x').searchParams.get('from') ?? '';
      return { ok: true, status: 200, body: JSON.stringify({ orders: server.filter(o => o.createdAt >= from) }) };
    },
    putOrders: async (_c: string, rows: Row[]) => { put.push(...rows); return { ok: true }; },
  };
  vi.stubGlobal('window', { posNative: { till } });
  return { put, asked };
}

afterEach(() => vi.unstubAllGlobals());

describe('pullNewOrders', () => {
  it('brings in an order this till has never seen', async () => {
    const { put } = fakeTill(
      [{ id: 'a', createdAt: '2026-10-05T07:30:00.000Z' }],
      [{ id: 'web', createdAt: '2026-10-05T07:32:00.000Z' }, { id: 'a', createdAt: '2026-10-05T07:30:00.000Z' }],
    );
    expect(await pullNewOrders('c1')).toBe(1);
    expect(put.map(o => o.id)).toEqual(['web']);
  });

  it("never puts the server's copy over an order the till already has", async () => {
    const { put } = fakeTill(
      [{ id: 'a', createdAt: '2026-10-05T07:30:00.000Z', status: 'ödənilib' }],   // paid here, not sent yet
      [{ id: 'a', createdAt: '2026-10-05T07:30:00.000Z', status: 'gözləyir' }],
    );
    expect(await pullNewOrders('c1')).toBe(0);
    expect(put).toEqual([]);
  });

  it('asks only for orders after the newest one here', async () => {
    const { asked } = fakeTill([{ id: 'a', createdAt: '2026-10-05T07:30:00.000Z' }], []);
    await pullNewOrders('c1');
    expect(new URL(asked[0], 'http://x').searchParams.get('from')).toBe('2026-10-05T07:28:00.000Z');
  });
});

describe('helpers', () => {
  it('unseenOrders keeps only new ids', () => {
    expect(unseenOrders([{ id: 'a' }, { id: 'b' }], new Set(['a']))).toEqual([{ id: 'b' }]);
  });

  it('newOrdersSince falls back to the last hour on an empty till', () => {
    const now = Date.parse('2026-10-05T10:00:00.000Z');
    expect(newOrdersSince(undefined, now)).toBe('2026-10-05T08:58:00.000Z');
  });
});

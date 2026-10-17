// 2026-10-17, Parviz: the website till opened by a terminal link inserted new
// orders straight into Supabase under the anon key. When anon lost write access
// on production (close_anon_doors), every new order failed with "İcazə xətası".
// A link till has no account: its new orders go through /api/add-order with the
// link's token, both when placed and when replayed from the offline queue.

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queue: { id: string; kind: string; body: unknown; companyId: string | null; seq: number; queuedAt: string; attempts: number }[] = [];

vi.mock('@/lib/offline-queue', () => ({
  getAllQueued: async () => [...queue],
  dequeue: async (id: string) => { const i = queue.findIndex(q => q.id === id); if (i >= 0) queue.splice(i, 1); },
  incrementAttempts: async () => {},
  queueSize: async () => queue.length,
}));
vi.mock('@/lib/till-write', () => ({
  apiBase: async () => '',
  hasLocalDb: () => false,
  attemptedWrite: async () => {}, dropWrite: async () => {}, pendingList: async () => [], pendingWrites: async () => 0,
}));
const addOrder = vi.fn(async () => 'permission denied for table orders');
vi.mock('@/lib/store', () => ({ addOrder }));
vi.mock('@/lib/terminal-link', () => ({ readLink: async () => null }));

const { flushQueue, ADD_ORDER } = await import('@/lib/sync');
const { setTillToken } = await import('@/lib/till-data');

beforeEach(() => { queue.length = 0; setTillToken(null); addOrder.mockClear(); });

describe('a queued order from a link till in a browser', () => {
  it('goes to /api/add-order with the token, not straight to Supabase', async () => {
    setTillToken('tok');
    queue.push({ id: 'order:o1', kind: ADD_ORDER, body: { id: 'o1', items: [] }, companyId: 'c1', seq: 1, queuedAt: new Date().toISOString(), attempts: 0 });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await flushQueue('c1');
    expect(addOrder).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/add-order');
    expect(JSON.parse(String(init.body))).toMatchObject({ companyId: 'c1', token: 'tok', order: { id: 'o1' } });
    expect(queue).toHaveLength(0);
  });
});

describe('the seller page', () => {
  it('sends a new order from a link till through the server', () => {
    const src = readFileSync('app/seller/page.tsx', 'utf8');
    expect(src).toMatch(/overrideCompanyId && overrideToken\s*\?\s*await sendOrderByLink\(/);
  });
});

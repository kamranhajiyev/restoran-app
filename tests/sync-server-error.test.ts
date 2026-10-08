// 2026-10-08: the replay read a 502 from Vercel or a 500 from a Supabase hiccup
// as the server saying no, and dropped every write but an order on it — a
// payment included. The till showed the order paid; the server never heard of
// it. A server failure keeps the write; only a real refusal drops it.

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
vi.mock('@/lib/store', () => ({ addOrder: async () => null }));
vi.mock('@/lib/terminal-link', () => ({ readLink: async () => null }));

const { flushQueue, serverFailed, otherCompany, SEND_MS } = await import('@/lib/sync');
const { setTillToken } = await import('@/lib/till-data');

const payment = () => ({
  id: 'pay:o1', kind: '/api/update-order-status', body: { orderId: 'o1', status: 'ödənilib' },
  companyId: 'c1', seq: 1, queuedAt: new Date().toISOString(), attempts: 0,
});
const answer = (status: number, body: string) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status })));

beforeEach(() => { queue.length = 0; setTillToken(null); });

describe('a queued payment', () => {
  it('is kept when Vercel answers 502 with an HTML page', async () => {
    queue.push(payment());
    answer(502, '<html>Bad Gateway</html>');
    await flushQueue('c1');
    expect(queue.map(q => q.id)).toEqual(['pay:o1']);
  });

  it('is kept when the route fails with a 500 and an error message', async () => {
    queue.push(payment());
    answer(500, JSON.stringify({ ok: false, error: 'connection terminated unexpectedly' }));
    await flushQueue('c1');
    expect(queue.map(q => q.id)).toEqual(['pay:o1']);
  });

  it('is dropped when the server really says no', async () => {
    queue.push(payment());
    answer(200, JSON.stringify({ ok: false }));
    await flushQueue('c1');
    expect(queue).toEqual([]);
  });

  it('leaves when it lands', async () => {
    queue.push(payment());
    answer(200, JSON.stringify({ ok: true }));
    await flushQueue('c1');
    expect(queue).toEqual([]);
  });
});

describe('a server failure', () => {
  it('is a 5xx, a timeout or a rate limit — not a refusal', () => {
    for (const s of [500, 502, 503, 504, 408, 429]) expect(serverFailed(s)).toBe(true);
    for (const s of [200, 400, 403, 404, undefined]) expect(serverFailed(s)).toBe(false);
  });
});

// The same mistake in two more places: a missing company read as another
// company, and a revoked link read as a refused sale. Both deleted writes.
describe('a queued write', () => {
  it('is not deleted when the till has no link company — a signed-in exe', async () => {
    queue.push(payment());
    answer(200, JSON.stringify({ ok: true }));
    await flushQueue(null);
    expect(queue).toEqual([]); // sent, not thrown away
    expect(otherCompany('c1', null)).toBe(false);
    expect(otherCompany(null, 'c1')).toBe(false);
    expect(otherCompany('c1', 'c2')).toBe(true);
  });

  it('waits for a working link when the server says the link is revoked', async () => {
    queue.push(payment());
    answer(403, JSON.stringify({ ok: false, error: 'revoked' }));
    await flushQueue('c1');
    expect(queue.map(q => q.id)).toEqual(['pay:o1']);
  });

  it('goes out with the link the till holds now, not the one it was queued with', async () => {
    queue.push({ ...payment(), body: { orderId: 'o1', status: 'ödənilib', token: 'old' } });
    setTillToken('new');
    const sent: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));
    await flushQueue('c1');
    expect(sent).toEqual([{ orderId: 'o1', status: 'ödənilib', token: 'new' }]);
  });
});

// 2026-10-08: a send that never answered held the queue until a restart, and
// the reconnect drain and the timer could send the same write twice at once.
describe('the queue', () => {
  it('keeps a write whose send never answers, and stops waiting for it', async () => {
    vi.useFakeTimers();
    try {
      queue.push(payment());
      vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
      const done = flushQueue('c1');
      await vi.advanceTimersByTimeAsync(SEND_MS + 1);
      expect((await done).stillQueued).toBe(1);
      expect(queue.map(q => q.id)).toEqual(['pay:o1']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends each write once when two drains start together', async () => {
    queue.push(payment());
    const send = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', send);
    await Promise.all([flushQueue('c1'), flushQueue('c1')]);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('a direct send', () => {
  it('has a time limit, on the till and on opening a shift', () => {
    expect(readFileSync('lib/offline-net.ts', 'utf8')).toMatch(/const res = await fetch\(route, \{[^}]*\}[^]*?signal: AbortSignal\.timeout/);
    expect(readFileSync('app/seller/page.tsx', 'utf8')).toMatch(/fetch\('\/api\/open-shift', \{[^]*?signal: AbortSignal\.timeout[^]*?\}\)\.then/);
  });
});

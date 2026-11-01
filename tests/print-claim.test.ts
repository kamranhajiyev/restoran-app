// 2026-11-01: how a till picks up kitchen tickets (lib/print-claim.ts) had no
// test. Wrong here, a ticket prints twice, never prints, or a till that was off
// for months runs every old ticket out onto the pass.

import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { MAX_ATTEMPTS, claimPending } from '@/lib/print-claim';

type Call = { op: 'update' | 'select'; values?: unknown; filters: [string, string, unknown][]; limit?: number };
type Answer = { data?: unknown; error?: { message: string } | null; status?: number };

/** A pretend database: records every query and answers them in turn. */
function fakeDb(answers: Answer[]) {
  const calls: Call[] = [];
  const db = {
    from: () => {
      const call: Call = { op: 'select', filters: [] };
      const chain = {
        update: (values: unknown) => { call.op = 'update'; call.values = values; return chain; },
        select: () => chain,
        eq: (c: string, v: unknown) => { call.filters.push(['eq', c, v]); return chain; },
        lt: (c: string, v: unknown) => { call.filters.push(['lt', c, v]); return chain; },
        gte: (c: string, v: unknown) => { call.filters.push(['gte', c, v]); return chain; },
        in: (c: string, v: unknown) => { call.filters.push(['in', c, v]); return chain; },
        order: () => chain,
        limit: (n: number) => { call.limit = n; return chain; },
        then: (resolve: (a: Answer) => void) => {
          calls.push(call);
          resolve({ data: null, error: null, ...(answers.shift() ?? {}) });
        },
      };
      return chain;
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

const has = (call: Call, kind: string, col: string, value?: unknown) =>
  call.filters.some(([k, c, v]) => k === kind && c === col && (value === undefined || JSON.stringify(v) === JSON.stringify(value)));

describe('claiming kitchen tickets', () => {
  it('hands back tickets a till took and never finished, after two minutes', async () => {
    const { db, calls } = fakeDb([{}, { data: [] }]);
    const before = Date.now();
    await claimPending(db, 'c1', 10);
    const [stale] = calls;
    expect(stale.op).toBe('update');
    expect(stale.values).toEqual({ status: 'pending', claimed_at: null });
    expect(has(stale, 'eq', 'status', 'printing')).toBe(true);
    const cutoff = Date.parse(stale.filters.find(f => f[1] === 'claimed_at')![2] as string);
    expect(before - cutoff).toBeGreaterThanOrEqual(2 * 60_000 - 50);
    expect(before - cutoff).toBeLessThan(2 * 60_000 + 1000);
  });

  it('takes only waiting tickets of this restaurant, under the try limit, from the last hour', async () => {
    const { db, calls } = fakeDb([{}, { data: [] }]);
    const before = Date.now();
    await claimPending(db, 'c1', 10);
    const read = calls[1];
    expect(has(read, 'eq', 'company_id', 'c1')).toBe(true);
    expect(has(read, 'eq', 'status', 'pending')).toBe(true);
    expect(has(read, 'lt', 'attempts', MAX_ATTEMPTS)).toBe(true);
    const since = Date.parse(read.filters.find(f => f[1] === 'created_at')![2] as string);
    expect(before - since).toBeGreaterThanOrEqual(60 * 60_000 - 50);
    expect(before - since).toBeLessThan(60 * 60_000 + 1000);
  });

  it('takes between 1 and 10 at a time', async () => {
    for (const [asked, taken] of [[0, 1], [5, 5], [50, 10]]) {
      const { db, calls } = fakeDb([{}, { data: [] }]);
      await claimPending(db, 'c1', asked);
      expect(calls[1].limit).toBe(taken);
    }
  });

  it('claims only tickets still waiting, so two tills cannot both win one', async () => {
    const { db, calls } = fakeDb([{}, { data: [{ id: 'j1' }, { id: 'j2' }] }, { data: [] }]);
    await claimPending(db, 'c1', 10);
    const claim = calls[2];
    expect(claim.op).toBe('update');
    expect(claim.values).toMatchObject({ status: 'printing' });
    expect(has(claim, 'in', 'id', ['j1', 'j2'])).toBe(true);
    expect(has(claim, 'eq', 'status', 'pending')).toBe(true);
  });

  it('gives back only what it won, oldest first', async () => {
    const won = [
      { id: 'j2', created_at: '2026-11-01T10:00:02Z' },
      { id: 'j1', created_at: '2026-11-01T10:00:01Z' },
    ];
    const { db } = fakeDb([{}, { data: [{ id: 'j1' }, { id: 'j2' }, { id: 'j3' }] }, { data: won }]);
    const res = await claimPending(db, 'c1', 10);
    expect('jobs' in res && res.jobs.map(j => j.id)).toEqual(['j1', 'j2']);
  });

  it('keeps to the stations it was given, and leaves the rest alone', async () => {
    const { db, calls } = fakeDb([{}, { data: [{ id: 'j1' }] }, { data: [] }]);
    await claimPending(db, 'c1', 10, ['bar']);
    expect(has(calls[0], 'in', 'station_id', ['bar'])).toBe(true);
    expect(has(calls[1], 'in', 'station_id', ['bar'])).toBe(true);
  });

  it('claims nothing when nothing is waiting', async () => {
    const { db, calls } = fakeDb([{}, { data: [] }]);
    expect(await claimPending(db, 'c1', 10)).toEqual({ jobs: [] });
    expect(calls).toHaveLength(2);
  });

  it('says a failed read failed, instead of "nothing to print"', async () => {
    const { db } = fakeDb([{}, { error: { message: 'timeout' }, status: 500 }]);
    expect(await claimPending(db, 'c1', 10)).toEqual({ error: 'timeout', status: 500 });
  });
});

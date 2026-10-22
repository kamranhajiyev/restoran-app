// A restaurant with no tables sets up a till.
//
// Latte Art test copy, 2026-10-22: setup showed "Masalar · boş cavab" forever,
// because an empty room was refused the way an empty menu is. Takeaway places
// have no tables. The refusal stays for a till that already has a room, where
// an empty answer means a broken request, not a restaurant without tables.

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/store', () => ({ setCompanyContext: () => {} }));
vi.mock('@/lib/till-image', () => ({ cacheImages: async () => 0 }));

import { pullAll } from '@/lib/till-sync';

function fakeTill(localTables: unknown[]) {
  const put: Record<string, unknown[]> = {};
  const till = {
    tables: async () => ({ tables: localTables, halls: [] }),
    api: async () => ({ ok: true, status: 200, body: JSON.stringify({ tables: [], halls: [] }) }),
    putReference: async (table: string, _c: string, rows: unknown[]) => { put[table] = rows; },
  };
  vi.stubGlobal('window', { posNative: { till } });
  return put;
}

afterEach(() => vi.unstubAllGlobals());

describe('the room step', () => {
  it('accepts a restaurant with no tables on a new till', async () => {
    const put = fakeTill([]);
    const { steps } = await pullAll('c1', undefined, new Set(['tables']));
    expect(steps[0].state).toBe('done');
    expect(put.tables).toEqual([]);
  });

  it('still refuses to wipe the room a till already has', async () => {
    const put = fakeTill([{ id: 't1' }]);
    const { steps } = await pullAll('c1', undefined, new Set(['tables']));
    expect(steps[0]).toMatchObject({ state: 'failed', error: 'boş cavab' });
    expect(put.tables).toBeUndefined();
  });
});

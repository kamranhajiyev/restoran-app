// Test Restoran, 2026-10-24: deleting a hall said "Bu zalda masalar var" and
// made the owner delete every table one by one first.

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
let tablesError: unknown = null;

vi.mock('@/lib/supabase', () => {
  const chain = (table: string) => {
    const c: Record<string, unknown> = {};
    c.eq = (_: string, v: unknown) => { calls.push(`${table} eq ${v}`); return c; };
    c.in = (_: string, v: unknown[]) => { calls.push(`${table} in ${v.join(',')}`); return c; };
    c.then = (res: (v: unknown) => unknown) =>
      Promise.resolve({ error: table === 'restaurant_tables' ? tablesError : null }).then(res);
    return c;
  };
  return { supabase: { from: (table: string) => ({ delete: () => chain(table) }) } };
});

import { deleteHall } from '@/lib/store';

describe('deleting a hall', () => {
  beforeEach(() => { calls.length = 0; tablesError = null; });

  it('takes its tables with it, in one statement, before the hall', async () => {
    expect(await deleteHall('h1', [3, 4])).toBeNull();
    expect(calls).toEqual(['restaurant_tables in 3,4', 'halls eq h1']);
  });

  it('keeps the hall when a table has an open order', async () => {
    tablesError = { code: 'P0001', message: 'table_has_open_order: x' };
    expect(await deleteHall('h1', [3])).toBe('Bu zalda aktiv sifarişi olan masa var.');
    expect(calls).toEqual(['restaurant_tables in 3']);
  });

  it('admin confirms with the table count and passes the tables', () => {
    const admin = readFileSync('app/admin/page.tsx', 'utf8');
    expect(admin).toContain('və içindəki {ids.length} masa silinəcək');
    expect(admin).toContain('deleteHall(activeHall.id, ids)');
  });
});

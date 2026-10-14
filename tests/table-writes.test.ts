// Code review, 2026-10-08: table edits, moves and drags said "saved" when the
// write never landed (supabase returns its errors, it does not throw them); a
// used table answered its delete in raw database English; and a failed reload
// after adding a table blanked the list.

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

let answer: { error: unknown } = { error: null };

vi.mock('@/lib/supabase', () => {
  const chain = () => {
    const c: Record<string, unknown> = {};
    c.eq = () => c;
    c.then = (res: (v: unknown) => unknown) => Promise.resolve(answer).then(res);
    return c;
  };
  return { supabase: { from: () => ({ update: chain, delete: chain }) } };
});

import { deleteTable, moveTableToHall, updateTable, updateTableLayout } from '@/lib/store';

describe('table writes', () => {
  it('report a failed save', async () => {
    answer = { error: { message: 'permission denied' } };
    expect(await updateTable(1, 'A', 4)).toBe('permission denied');
    expect(await updateTableLayout(1, 0, 0, 100, 70, 'rect')).toBe('permission denied');
    expect(await moveTableToHall(1, 'h1')).toBe('permission denied');
    answer = { error: null };
    expect(await updateTable(1, 'A', 4)).toBeNull();
  });

  // Since 2026-10-14 old orders keep the table's name, so only an open order
  // holds a table (20261024_order_table_name.sql).
  it('explain why a table with an open order cannot be deleted', async () => {
    answer = { error: { code: 'P0001', message: 'table_has_open_order: Aktiv sifarişi olan masanı silmək olmaz' } };
    expect(await deleteTable(1)).toBe('Aktiv sifarişi olan masanı silmək olmaz.');
  });
});

describe('admin tables screen', () => {
  const admin = readFileSync('app/admin/page.tsx', 'utf8');

  it('shows a failed save instead of "saved"', () => {
    expect(admin).toMatch(/updateTableLayout\([^)]*\)\.then\(err => \{\s+if \(err\) \{ setDialog/);
    expect(admin).toMatch(/const err = await updateTable\(/);
  });

  it('keeps the list when a reload fails', () => {
    expect(admin).not.toMatch(/setTables\(await fetchTables\(\)\)|const fresh = await fetchTables\(\)/);
    expect(admin).toMatch(/if \(fresh\) setTables\(fresh\);/);
    expect(admin).toMatch(/if \(tb\) setTables\(tb\);/);
  });
});

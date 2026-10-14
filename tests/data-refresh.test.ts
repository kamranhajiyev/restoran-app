import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { gatherParts } from '@/lib/data-refresh';

// Every menu or table edit made each open screen download everything — menu,
// tables, staff, couriers and 200 orders — once per edit (usage review,
// 2026-10-14).

describe('gatherParts', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('twenty dish edits are one menu read', () => {
    const fn = vi.fn();
    const soon = gatherParts(fn, 2000);
    for (let i = 0; i < 20; i++) soon('menu_items');
    vi.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(1);
    expect([...fn.mock.calls[0][0]]).toEqual(['menu']);
  });

  it('reads only the parts the burst touched', () => {
    const fn = vi.fn();
    const soon = gatherParts(fn, 2000);
    soon('categories');
    soon('halls');
    soon('restaurant_tables');
    vi.advanceTimersByTime(2000);
    expect([...fn.mock.calls[0][0]].sort()).toEqual(['menu', 'tables']);
  });

  it('a table edit alone does not read the menu', () => {
    const fn = vi.fn();
    const soon = gatherParts(fn, 2000);
    soon('restaurant_tables');
    vi.advanceTimersByTime(2000);
    expect([...fn.mock.calls[0][0]]).toEqual(['tables']);
  });

  it('the next burst starts empty', () => {
    const fn = vi.fn();
    const soon = gatherParts(fn, 2000);
    soon('menu_items');
    vi.advanceTimersByTime(2000);
    soon('halls');
    vi.advanceTimersByTime(2000);
    expect([...fn.mock.calls[1][0]]).toEqual(['tables']);
  });
});

describe('no screen downloads everything on a live edit', () => {
  it('admin, the till and the kitchen screen gather edits instead of calling refreshAll', () => {
    for (const f of ['app/admin/page.tsx', 'app/seller/page.tsx', 'app/station/page.tsx']) {
      const lines = readFileSync(f, 'utf8').split('\n');
      const bad = lines.filter(l => /postgres_changes|onCompanyChange\(/.test(l) && /refreshAll/.test(l));
      expect(bad, f).toEqual([]);
    }
  });
});

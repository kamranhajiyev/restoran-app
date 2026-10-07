// 2026-10-07 (production logs): one sale is several realtime changes, and admin,
// the browser till and the kitchen screen re-downloaded 200 orders on each one.
// It was most of the month's egress, and the order reads had no company filter,
// so RLS checked the whole table: 68 of them hit the statement timeout.

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { coalesce } from '@/lib/coalesce';

describe('a burst of changes is one refresh', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('ten changes together download once', () => {
    const fn = vi.fn();
    const soon = coalesce(fn, 1500);
    for (let i = 0; i < 10; i++) soon();
    vi.advanceTimersByTime(1500);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('news is at most the wait late, and a later change refreshes again', () => {
    const fn = vi.fn();
    const soon = coalesce(fn, 1500);
    soon();
    vi.advanceTimersByTime(1000);
    soon(); // joins the wait, does not push it back
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
    soon();
    vi.advanceTimersByTime(1500);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('a closed screen does not refresh', () => {
    const fn = vi.fn();
    const soon = coalesce(fn, 1500);
    soon();
    soon.cancel();
    vi.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
  });

  it('every screen gathers its realtime refreshes', () => {
    for (const f of ['app/admin/page.tsx', 'app/seller/page.tsx', 'app/station/page.tsx']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).toMatch(/from '@\/lib\/coalesce'/);
      expect(src, f).not.toMatch(/table: '(orders|order_items)'[^)]*\}, \(\) => \{?\s*refresh/);
    }
  });
});

describe('order reads name the company', () => {
  it('fetchOrdersCount and the order list filter by company_id', () => {
    const store = readFileSync('lib/store.ts', 'utf8');
    const count = store.slice(store.indexOf('export async function fetchOrdersCount'), store.indexOf('type OrderQuery'));
    expect(count).toMatch(/\.eq\('company_id', _companyId\)/);
    const read = store.slice(store.indexOf('async function readOrders'), store.indexOf('return all.map'));
    expect(read).toMatch(/\.eq\('company_id', _companyId\)/);
  });
});

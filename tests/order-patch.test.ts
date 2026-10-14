// Every realtime change made admin, the browser till and the kitchen screen
// download the last 200 orders with all their dishes (and the kitchen and till
// every ready mark ever made). Now a change names its order, and the screen
// downloads that one and patches its list.

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Order } from '@/types';
import type { StationReady } from '@/lib/store';
import { changedOrderId, gatherOrderIds, patchOrders, patchReady } from '@/lib/order-patch';

const order = (id: string, minute: number, status = 'yeni') =>
  ({ id, createdAt: `2026-10-08T10:${String(minute).padStart(2, '0')}:00.000+00:00`, status }) as unknown as Order;
const ready = (orderId: string, stationId: string) =>
  ({ orderId, stationId, readyAt: '2026-10-08T10:00:00Z', readyBy: null }) as StationReady;

describe('changedOrderId', () => {
  it('reads the order from each table', () => {
    expect(changedOrderId('orders', { new: { id: 'a' } })).toBe('a');
    expect(changedOrderId('order_items', { new: { id: 'i1', order_id: 'a' } })).toBe('a');
    expect(changedOrderId('order_station_ready', { new: { order_id: 'a', station_id: 's' } })).toBe('a');
  });

  it('reads a delete from old', () => {
    expect(changedOrderId('orders', { new: {}, old: { id: 'a' } })).toBe('a');
    expect(changedOrderId('order_station_ready', { new: {}, old: { order_id: 'a', station_id: 's' } })).toBe('a');
  });

  it('cannot name the order of a deleted dish (RLS leaves only its id), so the screen reloads in full', () => {
    expect(changedOrderId('order_items', { new: {}, old: { id: 'i1' } })).toBeNull();
  });
});

describe('patchOrders', () => {
  const list = [order('c', 3), order('b', 2), order('a', 1)];

  it('replaces a changed order in place', () => {
    const out = patchOrders(list, ['b'], [order('b', 2, 'hazırdır')]);
    expect(out.map(o => o.id)).toEqual(['c', 'b', 'a']);
    expect(out[1].status).toBe('hazırdır');
  });

  it('puts a new order first', () => {
    expect(patchOrders(list, ['d'], [order('d', 4)]).map(o => o.id)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('drops an order the server no longer returns', () => {
    expect(patchOrders(list, ['b'], []).map(o => o.id)).toEqual(['c', 'a']);
  });

  it('keeps the same window as the full read', () => {
    expect(patchOrders(list, ['d'], [order('d', 4)], 3).map(o => o.id)).toEqual(['d', 'c', 'b']);
  });

  it('ignores orders it did not ask for', () => {
    expect(patchOrders(list, ['b'], [order('b', 2), order('x', 9)]).map(o => o.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('patchReady', () => {
  it('replaces only the asked orders\' marks', () => {
    const rows = [ready('a', 's1'), ready('b', 's1'), ready('b', 's2')];
    const out = patchReady(rows, ['b'], [ready('b', 's1')]);
    expect(out).toEqual([ready('a', 's1'), ready('b', 's1')]);
  });
});

describe('gatherOrderIds', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('a burst is one patch naming every order', () => {
    const fn = vi.fn();
    const soon = gatherOrderIds(fn, 1500);
    soon('a'); soon('b'); soon('a');
    vi.advanceTimersByTime(1500);
    expect(fn).toHaveBeenCalledTimes(1);
    expect([...fn.mock.calls[0][0]]).toEqual(['a', 'b']);
  });

  it('one change that cannot name its order makes the burst a full reload', () => {
    const fn = vi.fn();
    const soon = gatherOrderIds(fn, 1500);
    soon('a'); soon(null);
    vi.advanceTimersByTime(1500);
    expect(fn).toHaveBeenCalledWith(null);
  });

  it('starts empty after each patch', () => {
    const fn = vi.fn();
    const soon = gatherOrderIds(fn, 1500);
    soon('a');
    vi.advanceTimersByTime(1500);
    soon('b');
    vi.advanceTimersByTime(1500);
    expect([...fn.mock.calls[1][0]]).toEqual(['b']);
  });
});

describe('every screen patches instead of re-downloading', () => {
  it('admin, the browser till and the kitchen screen gather order ids', () => {
    for (const f of ['app/admin/page.tsx', 'app/seller/page.tsx', 'app/station/page.tsx']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).toMatch(/'orders', companyId, p => refreshSoon\(changedOrderId\('orders', p\)\)/);
      expect(src, f).toMatch(/patchOrders\(/);
    }
  });

  it('the order read can ask for only the named orders', () => {
    const store = readFileSync('lib/store.ts', 'utf8');
    const read = store.slice(store.indexOf('async function readOrders'), store.indexOf('return all.map'));
    expect(read).toMatch(/q\.in\('id', opts\.ids\)/);
  });
});

// The exe's five-minute sweep re-downloaded the whole restaurant every time —
// menu, room, staff, couriers and 200 orders with their dishes — even when
// nothing had changed (2026-10-05 load review). With the signal up it now
// fetches only what a signal named, and everything when the signal can't be
// trusted.

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/store', () => ({ setCompanyContext: () => {} }));
vi.mock('@/lib/till-image', () => ({ cacheImages: async () => 0 }));

import { FULL_PULL_EVERY_MS, planPull } from '@/lib/till-sync';

const now = 10_000_000;
const base = { signalUp: true, upSince: now - 20 * 60_000, lastFullAt: now - 10 * 60_000, now, heard: [] as never[] };

describe('the sweep', () => {
  it('fetches nothing when no signal said anything changed', () => {
    expect(planPull(base)).toEqual(new Set());
  });

  it('fetches only the orders after an order changed', () => {
    expect(planPull({ ...base, heard: ['orders'] })).toEqual(new Set(['orders', 'couriers']));
  });

  it('fetches the menu, room and settings after the owner changed one', () => {
    const plan = planPull({ ...base, heard: ['menu'] });
    expect(plan).not.toBe('all');
    for (const id of ['menu', 'categories', 'modifiers', 'tables', 'staff', 'settings'] as const) {
      expect((plan as Set<string>).has(id)).toBe(true);
    }
    expect((plan as Set<string>).has('orders')).toBe(false);
  });

  it('fetches everything while the signal is down', () => {
    expect(planPull({ ...base, signalUp: false })).toBe('all');
  });

  it('fetches everything when the signal came back after the last whole sweep', () => {
    expect(planPull({ ...base, upSince: now - 60_000 })).toBe('all');
  });

  it('fetches everything before the first whole sweep', () => {
    expect(planPull({ ...base, lastFullAt: 0 })).toBe('all');
  });

  it('fetches everything every half hour in case a message was lost', () => {
    expect(planPull({ ...base, lastFullAt: now - FULL_PULL_EVERY_MS })).toBe('all');
  });
});

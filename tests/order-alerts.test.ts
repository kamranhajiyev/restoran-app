// 2026-11-01: the kitchen screen's chime and beep (lib/orderAlerts.ts, used by
// app/station/page.tsx) had no test. A wrong diff means the kitchen misses
// "one more kebab", or beeps for an order that only scrolled out of the list.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { diffOrderAlerts, snapshotOrders } from '@/lib/orderAlerts';

type Items = { id?: string; quantity: number }[];
const snap = (orders: Record<string, Items>) =>
  snapshotOrders(Object.entries(orders).map(([id, items]) => [{ id, items }][0]));

const quiet = { newWork: false, removed: false };

describe('kitchen alerts', () => {
  it('stays quiet when nothing changed', () => {
    const a = snap({ o1: [{ id: 'i1', quantity: 2 }] });
    const b = snap({ o1: [{ id: 'i1', quantity: 2 }] });
    expect(diffOrderAlerts(a, b)).toEqual(quiet);
  });

  it('chimes for a new order', () => {
    const a = snap({ o1: [{ id: 'i1', quantity: 1 }] });
    const b = snap({ o1: [{ id: 'i1', quantity: 1 }], o2: [{ id: 'i2', quantity: 1 }] });
    expect(diffOrderAlerts(a, b)).toEqual({ newWork: true, removed: false });
  });

  it('chimes for a new dish on an open order', () => {
    const a = snap({ o1: [{ id: 'i1', quantity: 1 }] });
    const b = snap({ o1: [{ id: 'i1', quantity: 1 }, { id: 'i2', quantity: 1 }] });
    expect(diffOrderAlerts(a, b)).toEqual({ newWork: true, removed: false });
  });

  it('chimes for one more of the same dish', () => {
    const a = snap({ o1: [{ id: 'i1', quantity: 1 }] });
    const b = snap({ o1: [{ id: 'i1', quantity: 2 }] });
    expect(diffOrderAlerts(a, b)).toEqual({ newWork: true, removed: false });
  });

  it('beeps when a dish is taken off', () => {
    const a = snap({ o1: [{ id: 'i1', quantity: 1 }, { id: 'i2', quantity: 1 }] });
    const b = snap({ o1: [{ id: 'i1', quantity: 1 }] });
    expect(diffOrderAlerts(a, b)).toEqual({ newWork: false, removed: true });
  });

  it('beeps when one unit of two is taken off (the row stays)', () => {
    const a = snap({ o1: [{ id: 'i1', quantity: 2 }] });
    const b = snap({ o1: [{ id: 'i1', quantity: 1 }] });
    expect(diffOrderAlerts(a, b)).toEqual({ newWork: false, removed: true });
  });

  it('does both when one dish is swapped for another', () => {
    const a = snap({ o1: [{ id: 'i1', quantity: 1 }] });
    const b = snap({ o1: [{ id: 'i2', quantity: 1 }] });
    expect(diffOrderAlerts(a, b)).toEqual({ newWork: true, removed: true });
  });

  it('stays quiet when an old order drops out of the list', () => {
    const a = snap({ o1: [{ id: 'i1', quantity: 1 }], o2: [{ id: 'i2', quantity: 1 }] });
    const b = snap({ o2: [{ id: 'i2', quantity: 1 }] });
    expect(diffOrderAlerts(a, b)).toEqual(quiet);
  });

  it('ignores lines still being saved (no id yet)', () => {
    const a = snap({ o1: [{ id: 'i1', quantity: 1 }] });
    const b = snap({ o1: [{ id: 'i1', quantity: 1 }, { quantity: 3 }] });
    expect(diffOrderAlerts(a, b)).toEqual(quiet);
    expect(snap({ o1: [{ quantity: 3 }] }).get('o1')!.size).toBe(0);
  });

  it('is what the kitchen screen uses, not its own diff', () => {
    const page = readFileSync('app/station/page.tsx', 'utf8');
    expect(page).toContain('diffOrderAlerts(');
    expect(page).toContain('snapshotOrders(');
  });
});

// What may be done to an order, checked once for every copy that enforces it.
//
// The exe and the routes that read the order first ask `refusal`; the
// conditional UPDATEs on Supabase apply `guardQuery`. Test Restoran,
// 2026-10-05: the two had drifted, and the exe refused a courier the site
// allowed. Here every action meets every status, with and without a courier,
// and the two answers must match.

import { describe, expect, it } from 'vitest';
import { guardQuery, refusal, type OrderAction } from '@/lib/order-rules';
import type { OrderStatus } from '@/types';

type Row = { status: OrderStatus; courier_id: string | null; online: boolean };

// A stand-in for a PostgREST query that records the filters and can then say
// whether a row would match them — the same thing the database does.
class FakeQuery {
  checks: ((r: Row) => boolean)[] = [];
  neq(column: string, value: string) {
    this.checks.push(r => (r as Record<string, unknown>)[column] !== value);
    return this;
  }
  or(filter: string) {
    const parts = filter.split(',').map(p => {
      const [col, ...rest] = p.split('.');
      const op = rest.join('.');
      if (op === 'not.is.null') return (r: Row) => (r as Record<string, unknown>)[col] != null;
      if (op === 'is.true') return (r: Row) => (r as Record<string, unknown>)[col] === true;
      throw new Error(`filter the fake does not know: ${p}`);
    });
    this.checks.push(r => parts.some(f => f(r)));
    return this;
  }
  matches(r: Row) { return this.checks.every(c => c(r)); }
}

const STATUSES: OrderStatus[] = ['gözləyir', 'hazırlanır', 'hazırdır', 'ödənilib', 'ləğv edildi', 'silinib'];
const ACTIONS: OrderAction[] = ['edit', 'move', 'courier', 'cancel', 'status'];
const SHAPES = [
  { courierId: null, online: false },   // takeaway / table
  { courierId: 'k1', online: false },   // courier order
  { courierId: null, online: true },    // menu link, no rider yet
];

describe('order rules', () => {
  for (const action of ACTIONS) {
    it(`"${action}": the exe's answer and the database's answer always match`, () => {
      for (const status of STATUSES) {
        for (const shape of SHAPES) {
          const allowedHere = refusal(action, { status, ...shape }) === null;
          const q = guardQuery(new FakeQuery(), action);
          const allowedInDb = q.matches({ status, courier_id: shape.courierId, online: shape.online });
          expect({ action, status, shape, allowed: allowedInDb })
            .toEqual({ action, status, shape, allowed: allowedHere });
        }
      }
    });
  }

  it('lets a menu-link order get its first courier, but not a takeaway', () => {
    expect(refusal('courier', { status: 'gözləyir', online: true })).toBeNull();
    expect(refusal('courier', { status: 'gözləyir' })).toBe('not_courier');
  });

  it('does not cancel a deleted order', () => {
    expect(refusal('cancel', { status: 'silinib' })).toBe('closed');
  });

  it('never moves a paid order back to another status', () => {
    expect(refusal('status', { status: 'ödənilib' })).toBe('closed');
  });

  it('does not touch the dishes of a closed order', () => {
    for (const s of ['ödənilib', 'ləğv edildi', 'silinib'] as const) expect(refusal('edit', { status: s })).toBe('closed');
  });
});

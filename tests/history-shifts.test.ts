// Tarixçə by kassa shift, and the Kuryerdə box.
//
// Latte Art, 2026-10-05: Nağd 20 + Kart 10 showed under Cəmi 60, with the 30 ₼
// a rider still had nowhere on screen, and the only way to see one shift was to
// open its receipts one by one.

import { describe, expect, it } from 'vitest';
import { courierOutstanding, ordersOfShift, shiftLoadWindow, shiftsOfDay, shiftWindow } from '@/lib/history-shifts';

const dayStart = '2026-10-05T04:00:00.000Z';
const now = '2026-10-05T18:00:00.000Z';

describe('shiftsOfDay', () => {
  const yesterday = { id: 'y', openedBy: 'A', openedAt: '2026-10-04T05:00:00.000Z', closedAt: '2026-10-04T20:00:00.000Z' };
  const overnight = { id: 'n', openedBy: 'A', openedAt: '2026-10-04T21:00:00.000Z', closedAt: '2026-10-05T06:00:00.000Z' };
  const second = { id: 's2', openedBy: 'B', openedAt: '2026-10-05T14:00:00.000Z' };
  const first = { id: 's1', openedBy: 'A', openedAt: '2026-10-05T06:30:00.000Z', closedAt: '2026-10-05T14:00:00.000Z' };

  it("keeps today's shifts, first one first", () => {
    expect(shiftsOfDay([second, first, yesterday], dayStart, now).map(s => s.id)).toEqual(['s1', 's2']);
  });

  it('keeps a shift that started last night and ran into today', () => {
    expect(shiftsOfDay([overnight, yesterday], dayStart, now).map(s => s.id)).toEqual(['n']);
  });
});

describe('shiftWindow', () => {
  it('runs from opening to closing', () => {
    expect(shiftWindow({ id: 'a', openedBy: 'A', openedAt: '2026-10-05T06:00:00.000Z', closedAt: '2026-10-05T14:00:00.000Z' }, now))
      .toEqual({ from: '2026-10-05T06:00:00.000Z', to: '2026-10-05T14:00:00.000Z' });
  });

  it('runs up to now while the shift is open', () => {
    expect(shiftWindow({ id: 'a', openedBy: 'A', openedAt: '2026-10-05T14:00:00.000Z' }, now).to).toBe(now);
  });
});

describe('courierOutstanding', () => {
  it('is what makes Nağd + Kart + Kuryerdə equal Cəmi', () => {
    const orders = [
      { status: 'ödənilib', cashAmount: 10 },
      { status: 'ödənilib', cardAmount: 20 },
      { status: 'ödənilib', courierDebt: 30 },                      // rider still has it
      { status: 'ödənilib', courierDebt: 15, courierCash: 5 },      // partly handed over
      { status: 'ödənilib', courierDebt: 8, courierCard: 8 },       // settled
      { status: 'gözləyir', courierDebt: 12 },                      // not closed yet
    ];
    expect(courierOutstanding(orders)).toBe(40);
  });
});

// Latte Art, 2026-10-05: the morning cashier left orders open and the evening
// one took the money. Kassa counted them in the evening, Tarixçə in the
// morning, and the two screens disagreed by exactly those orders.
describe('ordersOfShift', () => {
  const morning = { id: 'm', openedBy: 'A', openedAt: '2026-10-05T06:00:00.000Z', closedAt: '2026-10-05T14:00:00.000Z' };
  const evening = { id: 'e', openedBy: 'B', openedAt: '2026-10-05T14:00:00.000Z' };
  const paidLater = { id: 'x', status: 'ödənilib' as const, createdAt: '2026-10-05T13:00:00.000Z', paidAt: '2026-10-05T15:00:00.000Z' };
  const paidMorning = { id: 'y', status: 'ödənilib' as const, createdAt: '2026-10-05T08:00:00.000Z', paidAt: '2026-10-05T09:00:00.000Z' };
  const stillOpen = { id: 'z', status: 'gözləyir' as const, createdAt: '2026-10-05T12:00:00.000Z' };
  const atHandover = { id: 'h', status: 'ödənilib' as const, createdAt: '2026-10-05T13:30:00.000Z', paidAt: '2026-10-05T14:00:00.000Z' };
  const all = [paidLater, paidMorning, stillOpen, atHandover];
  const ids = (s: typeof morning | typeof evening) => ordersOfShift(all, s, now).map(o => o.id).sort();

  it('puts an order in the shift that took the money, not the one that opened it', () => {
    expect(ids(morning)).toEqual(['y']);
    expect(ids(evening)).toContain('x');
  });

  it('keeps an order still open in the shift still running', () => {
    expect(ids(evening)).toContain('z');
    expect(ids(morning)).not.toContain('z');
  });

  it('gives an order paid at the handover to one shift only', () => {
    expect([...ids(morning), ...ids(evening)].filter(id => id === 'h')).toHaveLength(1);
  });

  it('fetches far enough back to find an order opened the day before', () => {
    expect(shiftLoadWindow(evening, now).from).toBe('2026-10-04T14:00:00.000Z');
  });
});

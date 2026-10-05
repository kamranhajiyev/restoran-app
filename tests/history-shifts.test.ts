// Tarixçə by kassa shift, and the Kuryerdə box.
//
// Latte Art, 2026-10-05: Nağd 20 + Kart 10 showed under Cəmi 60, with the 30 ₼
// a rider still had nowhere on screen, and the only way to see one shift was to
// open its receipts one by one.

import { describe, expect, it } from 'vitest';
import { courierOutstanding, shiftsOfDay, shiftWindow } from '@/lib/history-shifts';

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

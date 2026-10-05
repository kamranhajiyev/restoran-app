// Tarixçə shows only the sales in view (Test Restoran, 2026-10-05): Nağd +
// Kart + Kuryer = Cəmi in every shift and for the whole day. A courier's money
// counts as Nağd/Kart only if it came back inside the view; courier money for
// an order outside the view is Kassa's Mədaxil, not a sale here.

import { describe, expect, it } from 'vitest';
import { historyTotals } from '@/lib/history-shifts';
import { sumCollections } from '@/lib/courier-pending';

type O = { id: string; status: string; t: number; cashAmount?: number; cardAmount?: number;
  courierDebt?: number; courierCash?: number; courierCard?: number };
const total = (o: O) => o.t;
const paid = (id: string, t: number, x: Partial<O> = {}): O => ({ id, status: 'ödənilib', t, ...x });

// Növbə 5 from the screenshot: two cash table orders, one cash online order,
// and #99930 delivered and paid back in the same shift.
const shift5 = [
  paid('99929', 6, { cashAmount: 6 }), paid('99931', 6, { cashAmount: 6 }),
  paid('99932', 16, { cashAmount: 16 }),
  paid('99930', 23.6, { courierDebt: 23.6, courierCash: 23.6 }),
];
// Növbə 4: #99927 delivered, its 8 ₼ came back in Növbə 5.
const shift4 = [paid('99927', 8, { courierDebt: 8, courierCash: 8 })];

const add = (r: ReturnType<typeof historyTotals>) => Math.round((r.nagd + r.kart + r.kuryer) * 100) / 100;

describe('Tarixçə boxes', () => {
  it('a delivery paid back in the same shift is Nağd', () => {
    const r = historyTotals(shift5, total, new Set(['99930', '99927']));
    expect(r).toEqual({ nagd: 51.6, kart: 0, kuryer: 0, cemi: 51.6 });
  });

  it('a delivery paid back in a later shift is Kuryer in its own shift', () => {
    const r = historyTotals(shift4, total, new Set());
    expect(r).toEqual({ nagd: 0, kart: 0, kuryer: 8, cemi: 8 });
  });

  it('the whole day counts it as Nağd once paid that day', () => {
    const r = historyTotals([...shift4, ...shift5], total, new Set(['99930', '99927']));
    expect(r).toEqual({ nagd: 59.6, kart: 0, kuryer: 0, cemi: 59.6 });
  });

  it('a delivery not paid back yet is Kuryer', () => {
    const r = historyTotals([paid('a', 10, { courierDebt: 10 })], total, new Set());
    expect(r.kuryer).toBe(10);
  });

  it('a card settlement is Kart', () => {
    const r = historyTotals([paid('a', 7.2, { courierDebt: 7.2, courierCard: 7.2 })], total, new Set(['a']));
    expect(r).toEqual({ nagd: 0, kart: 7.2, kuryer: 0, cemi: 7.2 });
  });

  it('always adds up, change and split payments included', () => {
    const orders = [
      paid('a', 10, { cashAmount: 4, cardAmount: 6 }),
      paid('b', 9.5, { cashAmount: 9.5 }),
      paid('c', 12, { courierDebt: 12, courierCash: 5 }),
      { id: 'd', status: 'ləğv edildi', t: 30 },
    ];
    const r = historyTotals(orders, total, new Set(['c']));
    expect(add(r)).toBe(r.cemi);
    expect(r.cemi).toBe(31.5);
  });

  it('offline, without the payment list, every settlement counts', () => {
    expect(historyTotals(shift4, total).nagd).toBe(8);
  });
});

describe('sumCollections', () => {
  it('sums money by road and lists the orders the payments named', () => {
    const r = sumCollections([
      { amount: '8', method: 'nağd', order_ids: ['99927'] },
      { amount: 12, method: 'nağd', order_ids: ['x', 'y'] },
      { amount: 5, method: 'kart', order_ids: null },
    ]);
    expect(r).toEqual({ nagd: 20, kart: 5, paidOrderIds: ['99927', 'x', 'y'] });
  });
});

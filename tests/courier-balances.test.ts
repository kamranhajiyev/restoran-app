// A courier's Borcu was summed in three places (lib/store's balance and ledger,
// /api/public-couriers), each from one read — and one read returns at most 1000
// rows. İXLAS CAFE had 819 paid courier orders after its first month
// (2026-11-01): days later, deliveries would have dropped out of the sum and
// every rider's debt read too low. Now one rule (courierBalances) over every
// row (readAll).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { courierBalances } from '@/lib/courier-pending';
import { readAll } from '@/lib/read-all';

describe('courier balance', () => {
  it('deliveries less what he handed over, per courier', () => {
    const orders = [
      { courier_id: 'ali', courier_debt: 20 },
      { courier_id: 'ali', courier_debt: '15.50' },
      { courier_id: 'vali', courier_debt: 8 },
      { courier_id: null, courier_debt: 99 }, // not on a courier
    ];
    const payments = [{ courier_id: 'ali', amount: 30 }, { courier_id: 'vali', amount: '10' }];
    // vali paid 10 for 8: the restaurant owes him 2
    expect(courierBalances(orders, payments)).toEqual({ ali: 5.5, vali: -2 });
  });

  it('is to the qəpik, not 0.30000000000000004', () => {
    expect(courierBalances([{ courier_id: 'a', courier_debt: 0.1 }, { courier_id: 'a', courier_debt: 0.2 }], []))
      .toEqual({ a: 0.3 });
  });
});

describe('every row, not the first 1000', () => {
  const rows = Array.from({ length: 2500 }, (_, i) => ({ courier_id: 'ali', courier_debt: 1, i }));
  const server = async (from: number, to: number) => ({ data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null });

  it('reads page after page until a short one', async () => {
    const all = await readAll(server);
    expect(all).toHaveLength(2500);
    expect(courierBalances(all!, [])).toEqual({ ali: 2500 });
  });

  it('a failed page is a failed read, not a short balance', async () => {
    const flaky = async (from: number, to: number) => (from >= 1000 ? { data: null, error: 'down' } : server(from, to));
    expect(await readAll(flaky)).toBeNull();
  });
});

describe('no place sums the balance on its own or from one read', () => {
  const store = readFileSync('lib/store.ts', 'utf8');
  const route = readFileSync('app/api/public-couriers/route.ts', 'utf8');
  const fn = (name: string) => store.slice(store.indexOf(`export async function ${name}(`), store.indexOf('\n}\n', store.indexOf(`export async function ${name}(`)));

  it('the balance comes from courierBalances', () => {
    for (const src of [store, route]) expect(src).not.toMatch(/\[o\.courier_id\] = \(/);
    expect(route).toMatch(/courierBalances\(orders, payments\)/);
    expect(fn('fetchCourierOutstanding')).toMatch(/courierBalances\(/);
  });

  // A failed read of the deliveries with the payments read fine showed every
  // rider's debt too low, even negative, and the exe kept it as its snapshot.
  it('a failed read keeps what is on screen, not half the money', () => {
    expect(fn('fetchCourierOutstanding')).toMatch(/if \(!orders \|\| !payments\) return null;/);
    expect(fn('fetchCourierLedger')).toMatch(/if \(!orders \|\| !payments \|\| \(range && !allTime\)\) return null;/);
    expect(fn('fetchCouriersWithBalance')).toMatch(/if \(!balance \|\| !pendingRows\) return null;/);
    expect(route).toMatch(/if \(!orders \|\| !payments\) return Response\.json\(\{ error: 'read failed' \}, \{ status: 500 \}\)/);
    const seller = readFileSync('app/seller/page.tsx', 'utf8');
    expect(seller).toMatch(/if \(kr\) setCouriers\(kr\);/);
    expect(seller).toMatch(/const list = await fetchCouriersWithBalance\(\);\n\s*if \(!list\) return null;/);
    const panel = readFileSync('components/CourierPanel.tsx', 'utf8');
    expect(panel).toMatch(/if \(b\) setBalance\(b\)/);
    expect(panel).toMatch(/if \(l\) setLedger\(l\)/);
  });

  it('every courier and shift read pages through readAll', () => {
    for (const name of ['fetchCourierOutstanding', 'fetchCourierLedger', 'fetchCouriersWithBalance', 'fetchShiftSales']) {
      const body = fn(name);
      expect(body, name).toMatch(/readAll\(/);
      // each orders / courier_payments read is paged
      expect((body.match(/\.from\('(orders|courier_payments)'\)/g) ?? []).length, name)
        .toBe((body.match(/\.range\(a, b\)/g) ?? []).length);
    }
    for (const f of ['app/api/public-couriers/route.ts', 'app/api/public-shift-sales/route.ts']) {
      const src = readFileSync(f, 'utf8');
      expect((src.match(/\.from\('(orders|courier_payments)'\)/g) ?? []).length, f)
        .toBe((src.match(/\.range\(a, b\)/g) ?? []).length);
    }
  });
});

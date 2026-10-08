// Code review, 2026-10-09: two ways a shift could close on the wrong money.
// - A logged-in till or admin read the courier card payments, dropped a failed
//   read as 0, and closed the shift with the Terminal figure short by all of it.
// - A second close of the same shift (another till, or one that was offline)
//   wrote over the counted cash and card of the first.

import { afterEach, describe, expect, it, vi } from 'vitest';

type Row = { id: string; company_id: string; closed_at: string | null; counted_cash: number | null };

// A tiny cash_shifts table: an update lands only on rows matching every filter.
function fakeDb(rows: Row[], reads: Record<string, { data: unknown; error: unknown }> = {}) {
  return {
    from: (table: string) => {
      const filters: ((r: Row) => boolean)[] = [];
      let patch: Partial<Row> | null = null;
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.gte = () => c;
      c.eq = (k: keyof Row, v: unknown) => { filters.push(r => r[k] === v); return c; };
      c.is = (k: keyof Row, v: unknown) => { filters.push(r => r[k] === v); return c; };
      c.update = (p: Partial<Row>) => { patch = p; return c; };
      c.then = (res: (v: unknown) => unknown) => {
        if (patch) {
          for (const r of rows) if (filters.every(f => f(r))) Object.assign(r, patch);
          return Promise.resolve({ error: null }).then(res);
        }
        return Promise.resolve(reads[table] ?? { data: [], error: null }).then(res);
      };
      return c;
    },
  };
}

const db = { current: fakeDb([]) };

vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => db.current.from(t) } }));
vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => db.current,
  verifySellerToken: async () => true,
}));

afterEach(() => { vi.resetModules(); });

const closeBody = (counted: number) => ({
  shiftId: 's1', expectedCash: 100, countedCash: counted, closedBy: 'Aynur', companyId: 'c1', token: 't',
});

describe('closing a shift', () => {
  it('does not close on a Terminal figure missing the courier card payments', async () => {
    db.current = fakeDb([], {
      orders: { data: [{ cash_amount: 50, card_amount: 80 }], error: null },
      courier_payments: { data: null, error: { message: 'timeout' } },
    });
    const { fetchShiftSales } = await import('@/lib/store');
    expect(await fetchShiftSales('2026-10-09T08:00:00Z')).toBeNull();
  });

  it('keeps the first close when a second one arrives through the till link', async () => {
    const rows: Row[] = [{ id: 's1', company_id: 'c1', closed_at: null, counted_cash: null }];
    db.current = fakeDb(rows);
    const { POST } = await import('@/app/api/close-shift/route');
    const send = (counted: number) => POST({ json: async () => closeBody(counted) } as never);

    expect(await (await send(150)).json()).toEqual({ ok: true });
    // The late one is answered ok, so its queue moves on, but changes nothing.
    expect(await (await send(90)).json()).toEqual({ ok: true });
    expect(rows[0].counted_cash).toBe(150);
  });

  it('keeps the first close when a logged-in till closes it again', async () => {
    const rows: Row[] = [{ id: 's1', company_id: 'c1', closed_at: null, counted_cash: null }];
    db.current = fakeDb(rows);
    const { closeShift } = await import('@/lib/store');
    await closeShift('s1', 100, 150, 'Aynur');
    await closeShift('s1', 100, 90, 'Nigar');
    expect(rows[0].counted_cash).toBe(150);
  });
});

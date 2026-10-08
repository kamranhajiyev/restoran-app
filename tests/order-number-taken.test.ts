// Two tills offline at once can hand out the same order number. When the second
// one syncs, the number is taken (orders_company_order_number_unique) — the sale
// must still arrive, renumbered by the server, not be refused and lost.
// Test Restoran, №3436, 2026-09-19.

import { describe, expect, it, vi } from 'vitest';

const inserted: Record<string, unknown>[] = [];

const db = {
  from: (table: string) => ({
    insert: async (row: Record<string, unknown>) => {
      inserted.push(row);
      if (table === 'orders' && row.order_number === 45) {
        return { error: { message: 'duplicate key value violates unique constraint "orders_company_order_number_unique"' } };
      }
      return { error: null };
    },
    upsert: async () => ({ error: null }),
  }),
};

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => db,
  verifySellerToken: async () => 'c1',
}));
vi.mock('@/lib/idempotency', () => ({
  idempotencyKey: () => 'k1',
  claim: async () => ({ applied: false, release: async () => {}, commit: async () => {} }),
}));

import { POST } from '@/app/api/add-order/route';

describe('an order whose number another till already used', () => {
  it('still arrives, numbered by the server', async () => {
    const req = new Request('https://x.test/api/add-order', {
      method: 'POST',
      body: JSON.stringify({
        companyId: 'c1',
        token: 't',
        keepOrderNumber: true,
        order: { id: 'o1', orderNumber: 45, tillNumber: 2, tableNumber: 0, sellerName: 'A', status: 'gözləyir', items: [], createdAt: '2026-10-08T10:00:00Z' },
      }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const last = inserted.filter(r => r.id === 'o1').at(-1)!;
    expect(last.order_number).toBeUndefined();
    expect(last.till_number).toBeUndefined();
  });
});

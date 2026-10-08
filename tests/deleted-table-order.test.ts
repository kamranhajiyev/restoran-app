// Code review, 2026-10-08: the owner deleted a table while a till still had an
// order on it (offline, or the exe had not pulled the change). The server
// refused the order (orders_table_id_fkey), the till kept it at the head of its
// queue, and every sale and payment behind it waited for good. It now arrives
// without a table.

import { describe, expect, it, vi } from 'vitest';

const inserted: Record<string, unknown>[] = [];

const db = {
  from: (table: string) => ({
    insert: async (row: Record<string, unknown>) => {
      inserted.push(row);
      if (table === 'orders' && row.table_id === 7) {
        return { error: { code: '23503', message: 'insert or update on table "orders" violates foreign key constraint "orders_table_id_fkey"' } };
      }
      if (table === 'orders' && row.staff_id === 'gone-staff') {
        return { error: { code: '23503', message: 'insert or update on table "orders" violates foreign key constraint "orders_staff_id_fkey"' } };
      }
      if (table === 'orders' && row.courier_id === 'gone-courier') {
        return { error: { code: '23503', message: 'insert or update on table "orders" violates foreign key constraint "orders_courier_id_fkey"' } };
      }
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

const send = (order: Record<string, unknown>) => POST(new Request('https://x.test/api/add-order', {
  method: 'POST',
  body: JSON.stringify({
    companyId: 'c1', token: 't', keepOrderNumber: true,
    order: { sellerName: 'A', status: 'gözləyir', items: [], createdAt: '2026-10-08T10:00:00Z', ...order },
  }),
}) as never);

describe('an order on a table deleted meanwhile', () => {
  it('arrives without the table, keeping its number', async () => {
    const res = await send({ id: 'o1', orderNumber: 12, tillNumber: 1, tableNumber: 7 });
    expect(await res.json()).toEqual({ ok: true });
    const last = inserted.filter(r => r.id === 'o1').at(-1)!;
    expect(last.table_id).toBeNull();
    expect(last.order_number).toBe(12);
  });

  it('arrives when its seller and courier were deleted too, keeping the rest', async () => {
    const res = await send({ id: 'o3', orderNumber: 13, tillNumber: 1, tableNumber: 7, staffId: 'gone-staff', courierId: 'gone-courier', sellerName: 'Aysel' });
    expect(await res.json()).toEqual({ ok: true });
    const last = inserted.filter(r => r.id === 'o3').at(-1)!;
    expect(last).toMatchObject({ table_id: null, staff_id: null, courier_id: null, waiter_name: 'Aysel', order_number: 13 });
  });

  it('keeps links that still exist', async () => {
    await send({ id: 'o4', orderNumber: 14, tillNumber: 1, tableNumber: 7, staffId: 's1', courierId: 'k1' });
    const last = inserted.filter(r => r.id === 'o4').at(-1)!;
    expect(last).toMatchObject({ table_id: null, staff_id: 's1', courier_id: 'k1' });
  });

  it('arrives even when its number was taken too', async () => {
    const res = await send({ id: 'o2', orderNumber: 45, tillNumber: 1, tableNumber: 7 });
    expect(await res.json()).toEqual({ ok: true });
    const last = inserted.filter(r => r.id === 'o2').at(-1)!;
    expect(last.table_id).toBeNull();
    expect(last.order_number).toBeUndefined();
  });
});

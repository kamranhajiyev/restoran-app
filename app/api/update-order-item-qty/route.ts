import { NextRequest } from 'next/server';
import { createServerClient, verifySellerToken } from '@/lib/supabase-server';

// Public terminal: change the quantity of one line on an open (unpaid) order. Token-gated; scoped
// to the order and company so a stale/forged token or wrong company can't touch it. A quantity of
// 0 or less removes the line. Stock is untouched — an unpaid order hasn't deducted anything.
export async function POST(req: NextRequest) {
  const { orderItemId, orderId, quantity, companyId, token } = (await req.json()) as {
    orderItemId?: string; orderId?: string; quantity?: number; companyId?: string; token?: string;
  };
  if (!orderItemId || !orderId || !companyId || typeof quantity !== 'number') {
    return Response.json({ ok: false }, { status: 400 });
  }
  if (!(await verifySellerToken(companyId, token ?? ''))) return Response.json({ ok: false, error: 'revoked' }, { status: 403 });

  const db = createServerClient();

  // Only allow editing an order that belongs to this company and is still open.
  const { data: order, error: orderErr } = await db
    .from('orders')
    .select('id, status')
    .eq('id', orderId)
    .eq('company_id', companyId)
    .single();
  if (orderErr || !order) return Response.json({ ok: false }, { status: 404 });
  if (order.status === 'ödənilib' || order.status === 'ləğv edildi' || order.status === 'silinib') {
    return Response.json({ ok: false, error: 'closed' }, { status: 409 });
  }

  const { error } = quantity <= 0
    ? await db.from('order_items').delete().eq('id', orderItemId).eq('order_id', orderId)
    : await db.from('order_items').update({ quantity }).eq('id', orderItemId).eq('order_id', orderId);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

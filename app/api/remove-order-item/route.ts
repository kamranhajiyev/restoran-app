import { NextRequest } from 'next/server';
import { createServerClient, verifySellerToken } from '@/lib/supabase-server';

// Public terminal: remove one line from an open (unpaid) order. Token-gated; scoped to the order
// and company so a stale/forged token or wrong company can't touch it. Stock is untouched — an
// unpaid order hasn't deducted anything.
export async function POST(req: NextRequest) {
  const { orderItemId, orderId, companyId, token } = (await req.json()) as {
    orderItemId?: string; orderId?: string; companyId?: string; token?: string;
  };
  if (!orderItemId || !orderId || !companyId) return Response.json({ ok: false }, { status: 400 });
  if (!(await verifySellerToken(companyId, token ?? ''))) return Response.json({ ok: false, error: 'revoked' }, { status: 403 });

  const db = createServerClient();

  // Only allow removing from an order that belongs to this company and is still open.
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

  const { error } = await db.from('order_items').delete().eq('id', orderItemId).eq('order_id', orderId);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

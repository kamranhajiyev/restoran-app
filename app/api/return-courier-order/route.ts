import { NextRequest } from 'next/server';
import { createServerClient, verifySellerToken } from '@/lib/supabase-server';
import { claim, idempotencyKey } from '@/lib/idempotency';

// The customer refused the food and the courier carried it back.
//
// /api/cancel-order deliberately refuses a paid order, and a courier-debt order
// is 'ödənilib' — closed, but with the money still out on a bike. This is the
// one narrow way out, and cancel_courier_order enforces that narrowness: an
// order that is not a courier order carrying debt is left untouched.
export async function POST(req: NextRequest) {
  const { orderId, reason, by, companyId, token } = await req.json();
  if (!orderId || !reason || !by) return Response.json({ ok: false }, { status: 400 });
  if (!(await verifySellerToken(companyId, token))) return Response.json({ ok: false, error: 'revoked' }, { status: 403 });

  const db = createServerClient();

  // The RPC answers true for an order already returned, so a replay is harmless
  // — but claiming first keeps the stored answer identical to the first one.
  const held = await claim(db, idempotencyKey(req), companyId, 'return-courier-order');
  if (held.applied) return Response.json(held.result);

  const { data: order } = await db.from('orders').select('id')
    .eq('id', orderId).eq('company_id', companyId).maybeSingle();
  if (!order) return Response.json({ ok: false, error: 'not_found' }, { status: 404 });

  const { data, error } = await db.rpc('cancel_courier_order', {
    p_order_id: orderId, p_reason: reason, p_by: by,
  });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  const result = { ok: data === true };
  await held.commit(result);
  return Response.json(result);
}

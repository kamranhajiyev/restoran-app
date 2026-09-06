// Handing an order to a different rider.
//
// Which courier takes an order is rarely known when it is rung up — the seller
// picks whoever is at the counter, and then someone else leaves first. So the
// choice made at the till is a first guess, and this is how it gets corrected.
//
// Mirrors /api/move-table exactly, because it is the same shape of write: one
// column on an order that is still open, guarded by the company, replayable from
// the offline queue.

import { NextRequest } from 'next/server';
import { createServerClient, verifySellerToken } from '@/lib/supabase-server';
import { claim, idempotencyKey } from '@/lib/idempotency';

export async function POST(req: NextRequest) {
  const { orderId, courierId, companyId, token } = await req.json();
  if (!orderId || !courierId) return Response.json({ ok: false }, { status: 400 });
  if (!(await verifySellerToken(companyId, token))) return Response.json({ ok: false, error: 'revoked' }, { status: 403 });

  const db = createServerClient();

  // A change queued offline may be followed by a second one made online.
  // Replaying the first afterwards would hand the order back to the old rider.
  const held = await claim(db, idempotencyKey(req), companyId, 'change-courier');
  if (held.applied) return Response.json(held.result);

  // The FK only proves the courier exists — this endpoint is public, so the
  // courier must also be proven to belong to the caller's company.
  const { data: courier } = await db
    .from('couriers')
    .select('id')
    .eq('id', courierId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (!courier) return Response.json({ ok: false, error: 'courier' }, { status: 400 });

  // Only while the order is open. Once it is paid the amount is already sitting
  // on a rider's balance as debt, and moving it would be a transfer between two
  // couriers' books — not this write.
  const { data, error } = await db
    .from('orders')
    .update({ courier_id: courierId })
    .eq('id', orderId)
    .eq('company_id', companyId)
    .not('courier_id', 'is', null)
    .neq('status', 'ödənilib')
    .neq('status', 'ləğv edildi')
    .neq('status', 'silinib')
    .select('id');
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  const result = { ok: (data?.length ?? 0) > 0 };
  await held.commit(result);
  return Response.json(result);
}

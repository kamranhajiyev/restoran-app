import { NextRequest } from 'next/server';
import { createServerClient, verifySellerToken } from '@/lib/supabase-server';
import { claim, idempotencyKey } from '@/lib/idempotency';

export async function POST(req: NextRequest) {
  const { orderId, reason, by, companyId, token } = await req.json();
  if (!orderId || !reason || !by) return Response.json({ ok: false }, { status: 400 });
  if (!(await verifySellerToken(companyId, token))) return Response.json({ ok: false, error: 'revoked' }, { status: 403 });

  const db = createServerClient();

  // The guards below make a second cancel a no-op, which would answer ok:false —
  // the till would read its own successful cancel as a failure and alarm the
  // waiter. Replay the first answer instead.
  const held = await claim(db, idempotencyKey(req), companyId, 'cancel-order');
  if (held.applied) return Response.json(held.result);

  const { data, error } = await db
    .from('orders')
    .update({
      status: 'ləğv edildi',
      cancelled_at: new Date().toISOString(),
      cancelled_by: by,
      cancel_reason: reason,
    })
    .eq('id', orderId)
    .eq('company_id', companyId)
    .neq('status', 'ödənilib')
    .neq('status', 'ləğv edildi')
    .select('id');
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  const result = { ok: (data?.length ?? 0) > 0 };
  await held.commit(result);
  return Response.json(result);
}

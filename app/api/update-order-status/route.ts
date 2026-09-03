import { NextRequest } from 'next/server';
import { createServerClient, verifySellerToken } from '@/lib/supabase-server';
import { claim, idempotencyKey } from '@/lib/idempotency';

export async function POST(req: NextRequest) {
  const { orderId, status, cashAmount, cardAmount, changeAmount, discountAmount, discountType, companyId, token } = await req.json();
  if (!orderId || !status) return Response.json({ ok: false }, { status: 400 });
  if (!(await verifySellerToken(companyId, token))) return Response.json({ ok: false, error: 'revoked' }, { status: 403 });

  const db = createServerClient();

  // A payment queued offline may arrive twice. Charging the guest again is the
  // worst thing this route could do, so it answers the first attempt's result
  // instead of repeating the work.
  const held = await claim(db, idempotencyKey(req), companyId, 'update-order-status');
  if (held.applied) return Response.json(held.result);

  const updates: Record<string, unknown> = { status };
  const hasAmounts = cashAmount !== undefined || cardAmount !== undefined || changeAmount !== undefined;
  if (hasAmounts) {
    updates.cash_amount = cashAmount ?? 0;
    updates.card_amount = cardAmount ?? 0;
    updates.change_amount = changeAmount ?? 0;
    updates.discount_amount = discountAmount ?? 0;
    updates.discount_type = discountType ?? '₼';
  }
  if (status === 'ödənilib') updates.paid_at = new Date().toISOString();

  let q = db.from('orders').update(updates).eq('id', orderId).eq('company_id', companyId);
  if (status === 'ödənilib') q = q.neq('status', 'ödənilib');
  q = q.neq('status', 'ləğv edildi');
  const { data, error } = await q.select('id');
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  const result = { ok: (data?.length ?? 0) > 0 };
  await held.commit(result);
  return Response.json(result);
}

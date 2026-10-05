import { NextRequest } from 'next/server';
import { createServerClient, verifySellerToken } from '@/lib/supabase-server';
import { claim, idempotencyKey } from '@/lib/idempotency';
import { guardQuery } from '@/lib/order-rules';

export async function POST(req: NextRequest) {
  const { orderId, status, cashAmount, cardAmount, changeAmount, discountAmount, discountType, courierDebt, companyId, token } = await req.json();
  if (!orderId || !status) return Response.json({ ok: false }, { status: 400 });
  if (!(await verifySellerToken(companyId, token))) return Response.json({ ok: false, error: 'revoked' }, { status: 403 });

  const db = createServerClient();

  // A payment queued offline may arrive twice. Charging the guest again is the
  // worst thing this route could do, so it answers the first attempt's result
  // instead of repeating the work.
  // Repeatable because the UPDATE below refuses an order already paid or
  // cancelled: running it a second time can never charge twice. Without this, a
  // request that died after its claim left the order unpayable for good.
  const held = await claim(db, idempotencyKey(req), companyId, 'update-order-status', { repeatable: true });
  if (held.applied) return Response.json(held.result);

  const updates: Record<string, unknown> = { status };
  const hasAmounts = cashAmount !== undefined || cardAmount !== undefined || changeAmount !== undefined;
  if (hasAmounts) {
    updates.cash_amount = cashAmount ?? 0;
    updates.card_amount = cardAmount ?? 0;
    updates.change_amount = changeAmount ?? 0;
    updates.discount_amount = discountAmount ?? 0;
    updates.discount_type = discountType ?? '₼';
    // Same statement as the amounts it stands in for, so an order can never be
    // both paid in cash and owed by a courier.
    updates.courier_debt = courierDebt ?? 0;
  }
  if (status === 'ödənilib') updates.paid_at = new Date().toISOString();

  // Paid and cancelled orders are final (lib/order-rules.ts) — the guard that
  // stops a second tap charging twice.
  const { data, error } = await guardQuery(
    db.from('orders').update(updates).eq('id', orderId).eq('company_id', companyId),
    'status',
  ).select('id');
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  let ok = (data?.length ?? 0) > 0;
  // Retrying a payment that died after its claim: if the order is already paid,
  // it was that earlier attempt that paid it, and the till must hear "done".
  if (!ok && held.resumed && status === 'ödənilib') {
    const { data: row } = await db.from('orders').select('status').eq('id', orderId).eq('company_id', companyId).maybeSingle();
    ok = row?.status === 'ödənilib';
  }
  const result = { ok };
  // Only a success is remembered. A refusal can change — the order may simply
  // not have arrived yet — and a remembered "no" was replayed to every later
  // press of Ödəniş, leaving the order unpayable for good (Latte Art
  // №4171/№4172, 2026-10-04). Forgetting it is safe: the UPDATE above refuses
  // an order already paid, so a retry can never charge twice.
  if (ok) await held.commit(result);
  else await held.release();
  return Response.json(result);
}

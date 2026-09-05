import { NextRequest } from 'next/server';
import { createServerClient, verifySellerToken } from '@/lib/supabase-server';
import { claim, idempotencyKey } from '@/lib/idempotency';

// A courier hands cash over at the counter.
//
// Two layers of replay protection, because this books money into a drawer:
// applied_mutations short-circuits the whole request, and add_courier_payment
// returns the existing id when it sees paymentId again. Either one alone would
// do; both means a retry cannot append a second drawer movement even if the
// first response was lost on the way back.
export async function POST(req: NextRequest) {
  const { paymentId, courierId, amount, by, staffId, shiftId, note, companyId, token } = await req.json();
  if (!paymentId || !courierId || !amount) return Response.json({ ok: false }, { status: 400 });
  if (!(await verifySellerToken(companyId, token))) return Response.json({ ok: false, error: 'revoked' }, { status: 403 });

  const db = createServerClient();

  const held = await claim(db, idempotencyKey(req), companyId, 'add-courier-payment');
  if (held.applied) return Response.json(held.result);

  // The courier must belong to the token's company — the RPC trusts a
  // service-role caller precisely because this route has already checked.
  const { data: courier } = await db.from('couriers').select('id')
    .eq('id', courierId).eq('company_id', companyId).maybeSingle();
  if (!courier) return Response.json({ ok: false, error: 'not_found' }, { status: 404 });

  const { error } = await db.rpc('add_courier_payment', {
    p_courier_id: courierId,
    p_amount: amount,
    p_created_by: by ?? null,
    p_staff_id: staffId ?? null,
    p_shift_id: shiftId ?? null,
    p_note: note ?? null,
    p_id: paymentId,
  });
  // 'overpay' is the courier owing less than the seller typed — a 4xx, so the
  // offline queue drops it as definitively refused instead of retrying forever.
  if (error) {
    const bad = /overpay|bad_amount|bad_courier/.test(error.message);
    return Response.json({ ok: false, error: error.message }, { status: bad ? 400 : 500 });
  }
  const result = { ok: true };
  await held.commit(result);
  return Response.json(result);
}

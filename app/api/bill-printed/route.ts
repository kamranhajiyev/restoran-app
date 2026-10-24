import { NextRequest } from 'next/server';
import { createServerClient, verifySellerToken } from '@/lib/supabase-server';
import { claim, idempotencyKey } from '@/lib/idempotency';
import { guardQuery } from '@/lib/order-rules';

// "Hesab" was printed for this order. From here on, taking a line off it or
// adding to it follows the after-bill rules (lib/till-rules.ts). The time is
// the till's, so a bill printed during an outage keeps the moment it was
// handed over.
export async function POST(req: NextRequest) {
  const { orderId, at, companyId, token } = await req.json();
  if (!orderId || !at || Number.isNaN(Date.parse(at))) return Response.json({ ok: false }, { status: 400 });
  if (!(await verifySellerToken(companyId, token))) return Response.json({ ok: false, error: 'revoked' }, { status: 403 });

  const db = createServerClient();
  const held = await claim(db, idempotencyKey(req), companyId, 'bill-printed');
  if (held.applied) return Response.json(held.result);

  const { data, error } = await guardQuery(
    db.from('orders').update({ bill_printed_at: at }).eq('id', orderId).eq('company_id', companyId),
    'edit',
  ).select('id');
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  const result = { ok: (data?.length ?? 0) > 0 };
  await held.commit(result);
  return Response.json(result);
}

import { NextRequest } from 'next/server';
import { createServerClient, verifySellerToken } from '@/lib/supabase-server';
import { claim, idempotencyKey } from '@/lib/idempotency';
import { cleanSplitParts } from '@/lib/split-bill';

// Public terminal: "Hesabı böl" — one table's bill becomes one per guest.
//
// The work is split_order() (20261107_split_order.sql), one transaction that
// prints nothing at the kitchen; this route only checks the token.
//
// parts: [{ orderId, orderNumber?, tillNumber?, lines: [{ id, quantity, newId }] }]
export async function POST(req: NextRequest) {
  const { orderId, parts, companyId, token } = (await req.json()) as {
    orderId?: string; parts?: unknown; companyId?: string; token?: string;
  };
  const clean = cleanSplitParts(parts);
  if (!orderId || !companyId || !clean) return Response.json({ ok: false }, { status: 400 });
  if (!(await verifySellerToken(companyId, token ?? ''))) return Response.json({ ok: false, error: 'revoked' }, { status: 403 });

  const db = createServerClient();

  // Repeatable: a bill that already exists is skipped, so a split sent twice
  // (a retry, the exe's replay) cannot move anything twice.
  const held = await claim(db, idempotencyKey(req), companyId, 'split-order', { repeatable: true });
  if (held.applied) return Response.json(held.result);

  const { error } = await db.rpc('split_order', { p_order_id: orderId, p_parts: clean, p_company: companyId });
  if (error) {
    await held.release();
    if (/not_found/.test(error.message)) return Response.json({ ok: false }, { status: 404 });
    if (/closed/.test(error.message)) return Response.json({ ok: false, error: 'closed' }, { status: 409 });
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  await held.commit({ ok: true });
  return Response.json({ ok: true });
}

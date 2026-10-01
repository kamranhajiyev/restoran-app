import { NextRequest } from 'next/server';
import { createServerClient, verifySellerToken } from '@/lib/supabase-server';
import { claim, idempotencyKey } from '@/lib/idempotency';

// Public terminal: take several lines (or units of them) off an open order in one go.
//
// One request, one transaction, one LƏĞV slip per station — "Silinməni əlavə et (3)" used to be
// three calls to /api/update-order-item-qty and three slips at the bar. The work is
// remove_order_items() (20261001_remove_order_items_batch.sql); this route only checks the token.
//
// lines: [{ orderItemId, quantity, ghostId? }] — quantity is what the line drops to, 0 removes it.
export async function POST(req: NextRequest) {
  const { orderId, lines, companyId, token, removedBy } = (await req.json()) as {
    orderId?: string;
    lines?: { orderItemId?: string; quantity?: number; ghostId?: string }[];
    companyId?: string; token?: string; removedBy?: string;
  };
  if (!orderId || !companyId || !Array.isArray(lines) || lines.length === 0
      || lines.some(l => !l.orderItemId || typeof l.quantity !== 'number')) {
    return Response.json({ ok: false }, { status: 400 });
  }
  if (!(await verifySellerToken(companyId, token ?? ''))) return Response.json({ ok: false, error: 'revoked' }, { status: 403 });

  const db = createServerClient();

  // Repeatable: the function skips lines already at their target and ghost rows carry the
  // till's ids, so running a half-finished batch again cannot double anything.
  const held = await claim(db, idempotencyKey(req), companyId, 'remove-order-items', { repeatable: true });
  if (held.applied) return Response.json(held.result);

  const { error } = await db.rpc('remove_order_items', {
    p_order_id: orderId,
    p_lines: lines.map(l => ({ id: l.orderItemId, quantity: l.quantity, ghostId: l.ghostId ?? null })),
    p_by: removedBy ?? 'Satıcı',
    p_company: companyId,
  });
  if (error) {
    await held.release();
    if (/not_found/.test(error.message)) return Response.json({ ok: false }, { status: 404 });
    if (/closed/.test(error.message)) return Response.json({ ok: false, error: 'closed' }, { status: 409 });
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  await held.commit({ ok: true });
  return Response.json({ ok: true });
}

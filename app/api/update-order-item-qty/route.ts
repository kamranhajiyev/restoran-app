import { NextRequest } from 'next/server';
import { createServerClient, verifySellerToken } from '@/lib/supabase-server';
import { claim, idempotencyKey } from '@/lib/idempotency';

// Public terminal: change the quantity of one line on an open (unpaid) order. Token-gated; scoped
// to the order and company so a stale/forged token or wrong company can't touch it. A quantity of
// 0 or less removes the line.
//
// Removal is a SOFT delete — the row stays, struck through on the order card, and it is what the
// kitchen's LEGV slip is built from. Stock is still untouched: apply_stock_on_payment() skips
// rows with removed_at set, so a removed dish never drains the warehouse.
export async function POST(req: NextRequest) {
  const { orderItemId, orderId, quantity, companyId, token, removedBy } = (await req.json()) as {
    orderItemId?: string; orderId?: string; quantity?: number; companyId?: string; token?: string; removedBy?: string;
  };
  if (!orderItemId || !orderId || !companyId || typeof quantity !== 'number') {
    return Response.json({ ok: false }, { status: 400 });
  }
  if (!(await verifySellerToken(companyId, token ?? ''))) return Response.json({ ok: false, error: 'revoked' }, { status: 403 });

  const db = createServerClient();

  // The ghost row below is an insert: replaying a queued decrement would print a
  // second "cancel 1 Cola" slip and double the struck-through line on the card.
  const held = await claim(db, idempotencyKey(req), companyId, 'update-order-item-qty');
  if (held.applied) return Response.json(held.result);

  // Only allow editing an order that belongs to this company and is still open.
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

  const now = new Date().toISOString();
  const by = removedBy ?? 'Satıcı';

  if (quantity <= 0) {
    const { error } = await db.from('order_items')
      .update({ removed_at: now, removed_by: by })
      .eq('id', orderItemId).eq('order_id', orderId)
      .is('removed_at', null);          // never re-stamp an already-removed line
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    await held.commit({ ok: true });
    return Response.json({ ok: true });
  }

  const { data: row, error: readErr } = await db
    .from('order_items')
    .select('menu_item_id, menu_item_name, menu_item_price, modifiers, modifiers_detail, variant_id, quantity')
    .eq('id', orderItemId).eq('order_id', orderId)
    .single();
  if (readErr || !row) return Response.json({ ok: false }, { status: 404 });

  const { error } = await db.from('order_items')
    .update({ quantity }).eq('id', orderItemId).eq('order_id', orderId);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  // A partial decrement records what was taken away: a ghost row, already removed,
  // carrying only the difference. It is what gets struck through on the card and
  // what the kitchen's "cancel 1 Cola" slip prints.
  const removedQty = row.quantity - quantity;
  if (removedQty > 0) {
    const { error: ghostErr } = await db.from('order_items').insert({
      order_id: orderId,
      menu_item_id: row.menu_item_id,
      menu_item_name: row.menu_item_name,
      menu_item_price: row.menu_item_price,
      modifiers: row.modifiers,
      modifiers_detail: row.modifiers_detail,
      variant_id: row.variant_id,
      quantity: removedQty,
      removed_at: now,
      removed_by: by,
    });
    // The quantity already dropped, so the guest is charged correctly regardless —
    // only the audit trail and the cancel slip are lost. Don't fail the action.
    if (ghostErr) console.error('[update-order-item-qty ghost]', ghostErr.message);
  }

  await held.commit({ ok: true });
  return Response.json({ ok: true });
}

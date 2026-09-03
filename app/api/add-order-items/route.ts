import { NextRequest } from 'next/server';
import { createServerClient, verifySellerToken } from '@/lib/supabase-server';
import { claim, idempotencyKey } from '@/lib/idempotency';
import type { SelectedModifier } from '@/types';

interface IncomingItem {
  // price already includes every selected modifier — the client folds them in.
  menuItem: { id: string | number; name: string; price: number };
  quantity: number;
  modifiers?: string;
  modifiersDetail?: SelectedModifier[];
  variantId?: string;
}

export async function POST(req: NextRequest) {
  const { orderId, items, companyId, note, token } = (await req.json()) as {
    orderId?: string;
    items?: IncomingItem[];
    companyId?: string;
    note?: string;
    token?: string;
  };
  if (!orderId || !companyId || !Array.isArray(items) || items.length === 0) {
    return Response.json({ ok: false }, { status: 400 });
  }
  if (!(await verifySellerToken(companyId, token ?? ''))) return Response.json({ ok: false, error: 'revoked' }, { status: 403 });

  const db = createServerClient();

  // Replaying a queued append would put the same dishes on the bill twice.
  const held = await claim(db, idempotencyKey(req), companyId, 'add-order-items');
  if (held.applied) return Response.json(held.result);

  // Only allow appending to an order that belongs to this company and is still open.
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

  const rows = items.map(oi => ({
    order_id: orderId,
    menu_item_id: String(oi.menuItem.id),
    menu_item_name: String(oi.menuItem.name),
    menu_item_price: Number(oi.menuItem.price),
    quantity: Number(oi.quantity),
    modifiers: oi.modifiers ?? null,
    modifiers_detail: oi.modifiersDetail ?? null,
    variant_id: oi.variantId ?? null,
  }));

  const { error } = await db.from('order_items').insert(rows);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  if (note !== undefined) {
    const { error: noteError } = await db.from('orders').update({ note: note || null }).eq('id', orderId).eq('company_id', companyId);
    if (noteError) return Response.json({ ok: false, error: noteError.message }, { status: 500 });
  }
  await held.commit({ ok: true });
  return Response.json({ ok: true });
}

import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

interface IncomingItem {
  menuItem: { id: string | number; name: string; price: number };
  quantity: number;
  modifiers?: string;
}

export async function POST(req: NextRequest) {
  const { orderId, items, companyId, note } = (await req.json()) as {
    orderId?: string;
    items?: IncomingItem[];
    companyId?: string;
    note?: string;
  };
  if (!orderId || !companyId || !Array.isArray(items) || items.length === 0) {
    return Response.json({ ok: false }, { status: 400 });
  }

  const db = createServerClient();

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
  }));

  const { error } = await db.from('order_items').insert(rows);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  if (note !== undefined) {
    const { error: noteError } = await db.from('orders').update({ note: note || null }).eq('id', orderId).eq('company_id', companyId);
    if (noteError) return Response.json({ ok: false, error: noteError.message }, { status: 500 });
  }
  return Response.json({ ok: true });
}

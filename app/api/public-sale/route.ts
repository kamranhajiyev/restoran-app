// Qaytarma on a link till: a paid sale found by its receipt number ("45",
// "45/2"), with what of it can still come back. Checked like every
// /api/public-* read. Any day, not just today: a receipt can be days old.
import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { refuseTillRead } from '@/lib/till-read-auth';
import { parseReceiptLabel, saleForReturn } from '@/lib/returns';
import { orderLabel } from '@/lib/order-label';

export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get('companyId');
  const label = parseReceiptLabel(req.nextUrl.searchParams.get('label') ?? '');
  if (!companyId || !label) return Response.json({ error: 'bad_request' }, { status: 400 });
  const refused = await refuseTillRead(req, companyId);
  if (refused) return refused;

  const db = createServerClient();
  let q = db.from('orders').select('id, order_number, till_number, status, discount_amount, order_items(menu_item_id, variant_id, menu_item_name, menu_item_price, quantity, removed_at)')
    .eq('company_id', companyId).eq('order_number', label.number).eq('status', 'ödənilib')
    .order('created_at', { ascending: false }).limit(1);
  q = label.till && label.till > 1 ? q.eq('till_number', label.till) : q.or('till_number.is.null,till_number.lte.1');
  const { data, error } = await q;
  if (error) return Response.json({ error: 'read failed' }, { status: 500 });
  const o = data?.[0] as Record<string, unknown> | undefined;
  if (!o) return Response.json({ sale: null });

  const { data: back } = await db.from('return_lines')
    .select('menu_item_id, variant_id, qty, returns!inner(order_id)').eq('returns.order_id', o.id as string);
  const items = ((o.order_items as Record<string, unknown>[]) ?? []).filter(i => !i.removed_at).map(i => ({
    menuItemId: String(i.menu_item_id), variantId: (i.variant_id as string | null) || null,
    name: String(i.menu_item_name), qty: Number(i.quantity), price: Number(i.menu_item_price),
  }));
  const sale = saleForReturn(
    { id: o.id as string, label: orderLabel({ orderNumber: o.order_number as number, tillNumber: (o.till_number as number) ?? undefined }), discountAmount: Number(o.discount_amount ?? 0) },
    items,
    (back ?? []).map(b => ({ menuItemId: b.menu_item_id as string | null, variantId: (b.variant_id as string | null) || null, qty: Number(b.qty) })),
  );
  return Response.json({ sale });
}

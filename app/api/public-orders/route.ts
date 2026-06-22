import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get('companyId');
  if (!companyId) return Response.json({ orders: [] }, { status: 400 });

  const db = createServerClient();
  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '200');
  const offset = parseInt(req.nextUrl.searchParams.get('offset') ?? '0');

  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');

  let countQ = db.from('orders').select('*', { count: 'exact', head: true }).eq('company_id', companyId);
  if (from) countQ = countQ.gte('created_at', from);
  if (to) countQ = countQ.lte('created_at', to);
  const { count: totalCount } = await countQ;

  let q = db.from('orders').select('*, order_items(*)').eq('company_id', companyId).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  if (from) q = q.gte('created_at', from);
  if (to) q = q.lte('created_at', to);
  const { data, error } = await q;

  if (error) return Response.json({ orders: [] }, { status: 500 });

  const orders = (data ?? []).map((o: Record<string, unknown>, i: number) => ({
    id: o.id,
    orderNumber: (o.order_number as number) ?? 0,
    tableNumber: o.table_id ?? 0,
    sellerName: o.waiter_name,
    staffId: o.staff_id ?? undefined,
    status: o.status,
    note: o.note ?? undefined,
    createdAt: o.created_at,
    cashAmount: o.cash_amount ? Number(o.cash_amount) : undefined,
    cardAmount: o.card_amount ? Number(o.card_amount) : undefined,
    changeAmount: o.change_amount ? Number(o.change_amount) : undefined,
    discountAmount: o.discount_amount ? Number(o.discount_amount) : undefined,
    discountType: o.discount_type ?? undefined,
    cancelledAt: o.cancelled_at ?? undefined,
    cancelledBy: o.cancelled_by ?? undefined,
    cancelReason: o.cancel_reason ?? undefined,
    items: ((o.order_items as Record<string, unknown>[]) ?? []).map((oi) => ({
      menuItem: {
        id: oi.menu_item_id,
        name: oi.menu_item_name,
        price: Number(oi.menu_item_price),
        category: '',
        available: true,
      },
      quantity: oi.quantity,
      modifiers: oi.modifiers ?? undefined,
    })),
  }));

  return Response.json({ orders, total: totalCount });
}

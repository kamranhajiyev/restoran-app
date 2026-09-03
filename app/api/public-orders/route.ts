import { NextRequest } from 'next/server';
import { splitOrderItems, type OrderItemRow } from '@/lib/order-items';
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

  // Order the nested rows too — the batch dividers need the items in the sequence
  // they were actually added, and nothing sorted them before.
  let q = db.from('orders').select('*, order_items(*)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .order('created_at', { referencedTable: 'order_items', ascending: true })
    .range(offset, offset + limit - 1);
  if (from) q = q.gte('created_at', from);
  if (to) q = q.lte('created_at', to);
  const { data, error } = await q;

  if (error) return Response.json({ orders: [] }, { status: 500 });

  const orders = (data ?? []).map((o: Record<string, unknown>, i: number) => ({
    id: o.id,
    orderNumber: (o.order_number as number) ?? 0,
    tillNumber: (o.till_number as number) ?? undefined,
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
    paidAt: o.paid_at ?? undefined,
    cancelledAt: o.cancelled_at ?? undefined,
    cancelledBy: o.cancelled_by ?? undefined,
    cancelReason: o.cancel_reason ?? undefined,
    // Same splitter as lib/store.ts fetchOrders: removed items never enter `items`,
    // so no total on this path can over-count them either.
    ...splitOrderItems(o.order_items as OrderItemRow[]),
  }));

  return Response.json({ orders, total: totalCount });
}

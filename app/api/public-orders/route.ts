import { NextRequest } from 'next/server';
import { splitOrderItems, type OrderItemRow } from '@/lib/order-items';
import { createServerClient } from '@/lib/supabase-server';
import { refuseTillRead } from '@/lib/till-read-auth';
import { CLOSED_STATUSES } from '@/types';

export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get('companyId');
  if (!companyId) return Response.json({ orders: [] }, { status: 400 });
  const refused = await refuseTillRead(req, companyId);
  if (refused) return refused;

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

  const orders = (data ?? []).map(toOrder);

  // Which of the open orders the till holds have been closed since — deleted or
  // cancelled in admin, paid on another till. Asked in the same request as the
  // new orders, so the till learns both from one call (lib/till-sync.ts
  // pullNewOrders). Almost always an empty answer.
  const closedIds = idList(req.nextUrl.searchParams.get('closedIds'));
  let closed: ReturnType<typeof toOrder>[] | undefined;
  if (closedIds.length) {
    const { data: rows, error: closedError } = await db.from('orders').select('*, order_items(*)')
      .eq('company_id', companyId)
      .in('id', closedIds)
      .in('status', [...CLOSED_STATUSES])
      .order('created_at', { referencedTable: 'order_items', ascending: true });
    if (closedError) return Response.json({ orders: [] }, { status: 500 });
    closed = (rows ?? []).map(toOrder);
  }

  return Response.json({ orders, total: totalCount, ...(closed ? { closed } : {}) });
}

/** Order ids from a comma list; anything that is not one is dropped. At most 100. */
function idList(raw: string | null): string[] {
  return (raw ?? '').split(',').filter(id => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 100);
}

function toOrder(o: Record<string, unknown>) {
  return {
    id: o.id,
    orderNumber: (o.order_number as number) ?? 0,
    tillNumber: (o.till_number as number) ?? undefined,
    tableNumber: o.table_id ?? 0,
    tableName: o.table_name ?? undefined,
    orderType: o.order_type ?? undefined,
    orderTypeName: o.order_type_name ?? undefined,
    serviceChargePercent: o.service_charge_percent ? Number(o.service_charge_percent) : undefined,
    sellerName: o.waiter_name,
    staffId: o.staff_id ?? undefined,
    // Without these the payment sheet cannot tell a delivery from a walk-in:
    // it would offer no courier choice and put the money in the drawer.
    courierId: o.courier_id ?? undefined,
    courierDebt: o.courier_debt ? Number(o.courier_debt) : undefined,
    courierCash: o.courier_cash ? Number(o.courier_cash) : undefined,
    courierCard: o.courier_card ? Number(o.courier_card) : undefined,
    // What makes a link order read as "Çatdırılma" and not as a takeaway.
    online: o.online ? true : undefined,
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
    billPrintedAt: o.bill_printed_at ?? undefined,
    // Same splitter as lib/store.ts fetchOrders: removed items never enter `items`,
    // so no total on this path can over-count them either.
    ...splitOrderItems(o.order_items as OrderItemRow[]),
  };
}

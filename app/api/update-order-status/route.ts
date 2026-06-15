import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const { orderId, status, cashAmount, cardAmount, tipAmount, changeAmount, discountAmount, discountType } = await req.json();
  if (!orderId || !status) return Response.json({ ok: false }, { status: 400 });

  const db = createServerClient();
  const updates: Record<string, unknown> = { status };
  const hasAmounts = cashAmount !== undefined || cardAmount !== undefined || tipAmount !== undefined || changeAmount !== undefined;
  if (hasAmounts) {
    updates.cash_amount = cashAmount ?? 0;
    updates.card_amount = cardAmount ?? 0;
    updates.tip_amount = tipAmount ?? 0;
    updates.change_amount = changeAmount ?? 0;
    updates.discount_amount = discountAmount ?? 0;
    updates.discount_type = discountType ?? '₼';
  }
  if (status === 'ödənilib') updates.paid_at = new Date().toISOString();

  let q = db.from('orders').update(updates).eq('id', orderId);
  if (status === 'ödənilib') q = q.neq('status', 'ödənilib');
  q = q.neq('status', 'ləğv edildi');
  const { data, error } = await q.select('id');
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: (data?.length ?? 0) > 0 });
}

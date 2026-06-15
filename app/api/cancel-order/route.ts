import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const { orderId, reason, by } = await req.json();
  if (!orderId || !reason || !by) return Response.json({ ok: false }, { status: 400 });

  const db = createServerClient();
  const { data, error } = await db
    .from('orders')
    .update({
      status: 'ləğv edildi',
      cancelled_at: new Date().toISOString(),
      cancelled_by: by,
      cancel_reason: reason,
    })
    .eq('id', orderId)
    .neq('status', 'ödənilib')
    .neq('status', 'ləğv edildi')
    .select('id');
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: (data?.length ?? 0) > 0 });
}

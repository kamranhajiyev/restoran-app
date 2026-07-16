import { NextRequest } from 'next/server';
import { createServerClient, verifySellerToken } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const { orderId, tableId, companyId, token } = await req.json();
  if (!orderId || !tableId) return Response.json({ ok: false }, { status: 400 });
  if (!(await verifySellerToken(companyId, token))) return Response.json({ ok: false, error: 'revoked' }, { status: 403 });

  const db = createServerClient();
  // The FK only proves the table exists — this endpoint is public, so the table
  // must also be proven to belong to the caller's company.
  const { data: table } = await db
    .from('restaurant_tables')
    .select('id')
    .eq('id', tableId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (!table) return Response.json({ ok: false, error: 'table' }, { status: 400 });

  const { data, error } = await db
    .from('orders')
    .update({ table_id: tableId })
    .eq('id', orderId)
    .eq('company_id', companyId)
    .neq('status', 'ödənilib')
    .neq('status', 'ləğv edildi')
    .neq('status', 'silinib')
    .select('id');
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: (data?.length ?? 0) > 0 });
}

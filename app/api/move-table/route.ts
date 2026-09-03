import { NextRequest } from 'next/server';
import { createServerClient, verifySellerToken } from '@/lib/supabase-server';
import { claim, idempotencyKey } from '@/lib/idempotency';

export async function POST(req: NextRequest) {
  const { orderId, tableId, companyId, token } = await req.json();
  if (!orderId || !tableId) return Response.json({ ok: false }, { status: 400 });
  if (!(await verifySellerToken(companyId, token))) return Response.json({ ok: false, error: 'revoked' }, { status: 403 });

  const db = createServerClient();

  // A move queued offline may be followed by a second move made online. Replaying
  // the first one afterwards would drag the party back to the old table.
  const held = await claim(db, idempotencyKey(req), companyId, 'move-table');
  if (held.applied) return Response.json(held.result);

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
  const result = { ok: (data?.length ?? 0) > 0 };
  await held.commit(result);
  return Response.json(result);
}

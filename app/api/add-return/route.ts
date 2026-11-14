// Public terminal: Qaytarma (SHOP-MODE.md, step 5). The work is
// record_return() (20261113_returns.sql), one transaction; this route only
// checks the link. Online only: the till never queues a return.
import { NextRequest } from 'next/server';
import { createServerClient, verifySellerToken } from '@/lib/supabase-server';
import type { ReturnRequest } from '@/lib/returns';

export async function POST(req: NextRequest) {
  const { companyId, token, request } = (await req.json()) as { companyId?: string; token?: string; request?: ReturnRequest };
  if (!companyId || !request?.id || !Array.isArray(request.lines)) return Response.json({ ok: false, error: 'bad_request' }, { status: 400 });
  if (!(await verifySellerToken(companyId, token ?? ''))) return Response.json({ ok: false, error: 'revoked' }, { status: 403 });

  const db = createServerClient();
  // Sent twice (a lost reply): the function finds the id and saves nothing more.
  const { data, error } = await db.rpc('record_return', {
    p_id: request.id, p_order_id: request.orderId, p_lines: request.lines, p_pay: request.pay,
    p_seller: request.seller, p_approved_by: request.approvedBy, p_company: companyId,
  });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 422 });
  return Response.json({ ok: true, total: (data as { total: number }).total });
}

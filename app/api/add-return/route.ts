// Public terminal: Qaytarma (SHOP-MODE.md, step 5). The work is
// record_return() (20261113_returns.sql), one transaction; this route only
// checks the link. Online only: the till never queues a return.
import { NextRequest } from 'next/server';
import { createServerClient, verifySellerToken } from '@/lib/supabase-server';
import { returnRpcArgs, type ReturnReply, type ReturnRequest } from '@/lib/returns';

export async function POST(req: NextRequest) {
  const { companyId, token, request } = (await req.json()) as { companyId?: string; token?: string; request?: ReturnRequest };
  if (!companyId || !request?.id || !Array.isArray(request.lines)) return Response.json({ ok: false, error: 'bad_request' }, { status: 400 });
  if (!(await verifySellerToken(companyId, token ?? ''))) return Response.json({ ok: false, error: 'revoked' }, { status: 403 });

  const db = createServerClient();
  // Sent twice (a lost reply): the function finds the id and saves nothing more.
  // The manager's PIN or card is checked in there, not here: one place.
  const { data, error } = await db.rpc('record_return', returnRpcArgs(request, companyId));
  if (error) return Response.json({ ok: false, error: error.message }, { status: 422 });
  const reply = data as ReturnReply;
  if (!reply.ok) return Response.json({ ok: false, error: reply.error ?? 'not_approved' }, { status: 403 });
  return Response.json({ ok: true, total: reply.total, approvedBy: reply.approvedBy });
}

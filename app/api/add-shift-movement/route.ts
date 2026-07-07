import { NextRequest } from 'next/server';
import { createServerClient, verifySellerToken } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const { shiftId, movement, companyId, token } = await req.json();
  if (!shiftId || !movement) return Response.json({ ok: false }, { status: 400 });
  if (!(await verifySellerToken(companyId, token))) return Response.json({ ok: false, error: 'revoked' }, { status: 403 });

  const db = createServerClient();
  // Ensure the shift belongs to the token's company before mutating it.
  const { data: shift } = await db.from('cash_shifts').select('id').eq('id', shiftId).eq('company_id', companyId).maybeSingle();
  if (!shift) return Response.json({ ok: false, error: 'not_found' }, { status: 404 });

  const { error } = await db.rpc('append_shift_movement', { shift_id: shiftId, movement });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

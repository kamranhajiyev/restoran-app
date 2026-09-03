import { NextRequest } from 'next/server';
import { createServerClient, verifySellerToken } from '@/lib/supabase-server';
import { claim, idempotencyKey } from '@/lib/idempotency';

export async function POST(req: NextRequest) {
  const { shiftId, movement, companyId, token } = await req.json();
  if (!shiftId || !movement) return Response.json({ ok: false }, { status: 400 });
  if (!(await verifySellerToken(companyId, token))) return Response.json({ ok: false, error: 'revoked' }, { status: 403 });

  const db = createServerClient();

  // append_shift_movement appends unconditionally, so a replay would book the
  // same cash in or out a second time and leave the drawer short at close.
  const held = await claim(db, idempotencyKey(req), companyId, 'add-shift-movement');
  if (held.applied) return Response.json(held.result);

  // Ensure the shift belongs to the token's company before mutating it.
  const { data: shift } = await db.from('cash_shifts').select('id').eq('id', shiftId).eq('company_id', companyId).maybeSingle();
  if (!shift) return Response.json({ ok: false, error: 'not_found' }, { status: 404 });

  const { error } = await db.rpc('append_shift_movement', { shift_id: shiftId, movement });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  await held.commit({ ok: true });
  return Response.json({ ok: true });
}

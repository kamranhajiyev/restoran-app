import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const { shiftId, movement } = await req.json();
  if (!shiftId || !movement) return Response.json({ ok: false }, { status: 400 });

  const db = createServerClient();
  const { error } = await db.rpc('append_shift_movement', { shift_id: shiftId, movement });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

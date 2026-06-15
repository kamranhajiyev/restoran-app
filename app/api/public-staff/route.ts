import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

// Public: returns active staff list for a company (no PINs).
// Called by the public seller terminal which has no Supabase auth session.
export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get('companyId');
  if (!companyId) return Response.json({ error: 'missing companyId' }, { status: 400 });

  const db = createServerClient();
  const { data, error } = await db
    .from('staff')
    .select('id, name, active, created_at')
    .eq('company_id', companyId)
    .order('created_at');

  if (error) return Response.json({ staff: [] });
  return Response.json({
    staff: (data ?? []).map(s => ({ id: s.id, name: s.name, active: s.active, createdAt: s.created_at })),
  });
}

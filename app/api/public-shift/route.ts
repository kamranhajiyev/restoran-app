import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

// Public: returns the open cash shift for a company without requiring a Supabase session.
export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get('companyId');
  if (!companyId) return Response.json({ shift: null }, { status: 400 });

  const db = createServerClient();
  const { data, error } = await db
    .from('cash_shifts')
    .select('*')
    .eq('company_id', companyId)
    .is('closed_at', null)
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return Response.json({ shift: null });

  return Response.json({
    shift: {
      id: data.id,
      openedAt: data.opened_at,
      openedBy: data.opened_by,
      openingCash: Number(data.opening_cash),
      closedAt: data.closed_at ?? undefined,
      movements: Array.isArray(data.movements) ? data.movements : [],
    },
  });
}

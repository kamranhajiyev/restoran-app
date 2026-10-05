import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { refuseTillRead } from '@/lib/till-read-auth';

// Public: the company's shifts that ran between `from` and `to`, for the seller
// terminal's Tarixçə shift picker. Only when they ran and who opened them — the
// cash counts stay behind the admin login.
export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get('companyId');
  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');
  if (!companyId || !from || !to) return Response.json({ shifts: [] }, { status: 400 });
  const refused = await refuseTillRead(req, companyId);
  if (refused) return refused;

  const db = createServerClient();
  const { data, error } = await db
    .from('cash_shifts')
    .select('id, opened_at, opened_by, closed_at')
    .eq('company_id', companyId)
    .lte('opened_at', to)
    .or(`closed_at.is.null,closed_at.gte."${from}"`)
    .order('opened_at', { ascending: true })
    .limit(20);

  if (error || !data) return Response.json({ shifts: [] }, { status: 500 });

  return Response.json({
    shifts: data.map(s => ({
      id: s.id,
      openedAt: s.opened_at,
      openedBy: s.opened_by,
      closedAt: s.closed_at ?? undefined,
    })),
  });
}

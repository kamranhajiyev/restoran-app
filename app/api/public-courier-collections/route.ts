import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

// Public: what couriers handed over between `from` and `to` (exclusive), split
// by how it arrived. For the seller terminal, which has no Supabase auth session
// of its own — the authed path uses fetchCourierCollections in lib/store.ts, and
// the two must answer the same thing or the till and the browser will disagree
// about the day's takings.
export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get('companyId');
  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');
  if (!companyId || !from || !to) return Response.json({ error: 'missing params' }, { status: 400 });

  const db = createServerClient();
  const { data, error } = await db.from('courier_payments')
    .select('amount, method')
    .eq('company_id', companyId)
    .gte('created_at', from)
    .lt('created_at', to);

  if (error || !data) return Response.json({ nagd: 0, kart: 0 });

  return Response.json(data.reduce((acc, p) => {
    if (p.method === 'kart') acc.kart += Number(p.amount ?? 0);
    else acc.nagd += Number(p.amount ?? 0);
    return acc;
  }, { nagd: 0, kart: 0 }));
}

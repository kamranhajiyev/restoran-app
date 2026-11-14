// A link till's returns between two times (Tarixçə, its Hesabat, Kassa).
// Checked like every /api/public-* read.
import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { refuseTillRead } from '@/lib/till-read-auth';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const companyId = p.get('companyId');
  const from = p.get('from');
  const to = p.get('to');
  if (!companyId || !from) return Response.json({ error: 'companyId and from required' }, { status: 400 });
  const refused = await refuseTillRead(req, companyId);
  if (refused) return refused;

  const db = createServerClient();
  let q = db.from('returns')
    .select('id, order_id, total, pay, seller_name, approved_by, created_at, return_lines(menu_item_id, variant_id, name, qty, price)')
    .eq('company_id', companyId).gte('created_at', from).order('created_at', { ascending: false }).limit(1000);
  if (to) q = q.lt('created_at', to);
  const { data, error } = await q;
  // A database without the table: no returns. Any other failure is a failure.
  if (error) {
    if (/returns/.test(error.message) && /does not exist|schema cache/.test(error.message)) return Response.json({ returns: [] });
    return Response.json({ error: 'read failed' }, { status: 500 });
  }
  return Response.json({ returns: data ?? [] });
}

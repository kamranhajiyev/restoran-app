import { NextRequest } from 'next/server';
import { createServerClient, verifySellerToken } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const { companyId, openingCash, openedBy, token } = await req.json();
  if (!companyId || !openedBy) return Response.json({ shift: null }, { status: 400 });
  if (!(await verifySellerToken(companyId, token))) return Response.json({ shift: null, error: 'revoked' }, { status: 403 });

  const db = createServerClient();
  const { data, error } = await db
    .from('cash_shifts')
    .insert({ company_id: companyId, opening_cash: openingCash, opened_by: openedBy })
    .select('*')
    .single();

  if (error || !data) {
    // Someone else may have just opened one — return it
    const { data: existing } = await db
      .from('cash_shifts')
      .select('*')
      .eq('company_id', companyId)
      .is('closed_at', null)
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) return Response.json({ shift: existing });
    return Response.json({ shift: null }, { status: 500 });
  }

  return Response.json({ shift: data });
}

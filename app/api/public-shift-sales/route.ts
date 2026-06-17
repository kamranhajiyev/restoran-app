import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get('companyId');
  const openedAt  = req.nextUrl.searchParams.get('openedAt');
  if (!companyId || !openedAt) return Response.json({ cash: 0, card: 0 }, { status: 400 });

  const db = createServerClient();
  const { data, error } = await db
    .from('orders')
    .select('cash_amount, card_amount')
    .eq('company_id', companyId)
    .eq('status', 'ödənilib')
    .gte('paid_at', openedAt);

  if (error || !data) return Response.json({ cash: 0, card: 0 });

  return Response.json({
    cash: data.reduce((s, o) => s + Number(o.cash_amount ?? 0), 0),
    card: data.reduce((s, o) => s + Number(o.card_amount ?? 0), 0),
  });
}

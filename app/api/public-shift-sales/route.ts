import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { refuseTillRead } from '@/lib/till-read-auth';
import { courierSold, courierStillOut } from '@/lib/courier-pending';

export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get('companyId');
  const openedAt  = req.nextUrl.searchParams.get('openedAt');
  if (!companyId || !openedAt) return Response.json({ cash: 0, card: 0 }, { status: 400 });
  const refused = await refuseTillRead(req, companyId);
  if (refused) return refused;

  const db = createServerClient();
  const [{ data, error }, { data: courierCard }] = await Promise.all([
    db
      .from('orders')
      .select('cash_amount, card_amount, courier_debt, courier_cash, courier_card')
      .eq('company_id', companyId)
      .eq('status', 'ödənilib')
      .gte('paid_at', openedAt),
    // A courier settling by card puts the money on the bank terminal, not in
    // the drawer — so it belongs in the Terminal figure the Z-report is checked
    // against. Cash settlements are drawer movements and are counted there.
    db
      .from('courier_payments')
      .select('amount')
      .eq('company_id', companyId)
      .eq('method', 'kart')
      .gte('created_at', openedAt),
  ]);

  if (error || !data) return Response.json({ cash: 0, card: 0, courierCard: 0, courierSales: 0, courier: 0 });

  const settledByCard = (courierCard ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0);
  return Response.json({
    cash: data.reduce((s, o) => s + Number(o.cash_amount ?? 0), 0),
    card: data.reduce((s, o) => s + Number(o.card_amount ?? 0), 0) + settledByCard,
    courierCard: settledByCard,
    courierSales: courierSold(data),
    courier: courierStillOut(data),
  });
}

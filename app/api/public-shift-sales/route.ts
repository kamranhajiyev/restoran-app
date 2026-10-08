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
  const [{ data, error }, { data: courierCard, error: courierError }] = await Promise.all([
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

  // A 500, not zeros: zeros read as "nothing sold", and closing the shift on
  // them wrote 0 ₼ into its expected cash.
  if (error || !data) return Response.json({ error: error?.message ?? 'read failed' }, { status: 500 });
  // The same for the courier card read: without it the Terminal figure is short
  // by every courier card payment, and the shift closes on it.
  if (courierError || !courierCard) return Response.json({ error: courierError?.message ?? 'read failed' }, { status: 500 });

  const settledByCard = (courierCard ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0);
  return Response.json({
    cash: data.reduce((s, o) => s + Number(o.cash_amount ?? 0), 0),
    card: data.reduce((s, o) => s + Number(o.card_amount ?? 0), 0) + settledByCard,
    courierCard: settledByCard,
    courierSales: courierSold(data),
    courier: courierStillOut(data),
  });
}

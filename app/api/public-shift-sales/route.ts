import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { refuseTillRead } from '@/lib/till-read-auth';
import { shiftSales } from '@/lib/shift-sales';
import { readAll } from '@/lib/read-all';

export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get('companyId');
  const openedAt  = req.nextUrl.searchParams.get('openedAt');
  if (!companyId || !openedAt) return Response.json({ cash: 0, card: 0 }, { status: 400 });
  const refused = await refuseTillRead(req, companyId);
  if (refused) return refused;

  const db = createServerClient();
  const [data, courierCard] = await Promise.all([
    readAll(async (a, b) => db
      .from('orders')
      .select('cash_amount, card_amount, courier_debt, courier_cash, courier_card')
      .eq('company_id', companyId)
      .eq('status', 'ödənilib')
      .gte('paid_at', openedAt)
      .order('id').range(a, b)),
    // A courier settling by card puts the money on the bank terminal, not in
    // the drawer — so it belongs in the Terminal figure the Z-report is checked
    // against. Cash settlements are drawer movements and are counted there.
    readAll(async (a, b) => db
      .from('courier_payments')
      .select('amount')
      .eq('company_id', companyId)
      .eq('method', 'kart')
      .gte('created_at', openedAt)
      .order('id').range(a, b)),
  ]);

  // A 500, not zeros: zeros read as "nothing sold", and closing the shift on
  // them wrote 0 ₼ into its expected cash.
  if (!data) return Response.json({ error: 'read failed' }, { status: 500 });
  // The same for the courier card read: without it the Terminal figure is short
  // by every courier card payment, and the shift closes on it.
  if (!courierCard) return Response.json({ error: 'read failed' }, { status: 500 });

  return Response.json(shiftSales(data, courierCard));
}

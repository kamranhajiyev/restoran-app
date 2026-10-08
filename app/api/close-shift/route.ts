import { NextRequest } from 'next/server';
import { createServerClient, verifySellerToken } from '@/lib/supabase-server';
import { clientTime } from '@/lib/client-time';

export async function POST(req: NextRequest) {
  const { shiftId, expectedCash, countedCash, closedBy, cardSales, countedCard, closedAt, companyId, token } = await req.json();
  if (!shiftId || !closedBy) return Response.json({ ok: false }, { status: 400 });
  if (!(await verifySellerToken(companyId, token))) return Response.json({ ok: false, error: 'revoked' }, { status: 403 });

  const db = createServerClient();
  const { error } = await db
    .from('cash_shifts')
    .update({
      // The till's own time: a close that waited in the queue keeps when it happened.
      closed_at: clientTime(closedAt),
      closed_by: closedBy,
      expected_cash: expectedCash,
      counted_cash: countedCash,
      card_sales: cardSales ?? null,
      counted_card: countedCard ?? null,
    })
    .eq('id', shiftId)
    .eq('company_id', companyId);

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

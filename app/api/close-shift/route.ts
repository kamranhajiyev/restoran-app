import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const { shiftId, expectedCash, countedCash, closedBy, cardSales, countedCard } = await req.json();
  if (!shiftId || !closedBy) return Response.json({ ok: false }, { status: 400 });

  const db = createServerClient();
  const { error } = await db
    .from('cash_shifts')
    .update({
      closed_at: new Date().toISOString(),
      closed_by: closedBy,
      expected_cash: expectedCash,
      counted_cash: countedCash,
      card_sales: cardSales ?? null,
      counted_card: countedCard ?? null,
    })
    .eq('id', shiftId);

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

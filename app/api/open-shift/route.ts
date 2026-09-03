import { NextRequest } from 'next/server';
import { createServerClient, verifySellerToken } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const { companyId, openingCash, openedBy, token, shiftId, openedAt } = await req.json();
  if (!companyId || !openedBy) return Response.json({ shift: null }, { status: 400 });
  if (!(await verifySellerToken(companyId, token))) return Response.json({ shift: null, error: 'revoked' }, { status: 403 });

  const db = createServerClient();
  // A till that opened its shift during an outage has already been booking
  // movements against an id it chose itself, and printed receipts under it.
  // Honour that id rather than minting a new one, or the queued movements
  // arrive orphaned. opened_at comes with it for the same reason: the shift
  // began when the waiter opened it, not when the line came back.
  const { data, error } = await db
    .from('cash_shifts')
    .insert({
      company_id: companyId,
      opening_cash: openingCash,
      opened_by: openedBy,
      ...(shiftId ? { id: shiftId } : {}),
      ...(openedAt ? { opened_at: openedAt } : {}),
    })
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

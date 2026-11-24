// Qaytarma on a link till: a paid sale found by its receipt number ("45",
// "45/2"), with what of it can still come back (lib/returns findSale). Checked
// like every /api/public-* read. Any day, not just today: a receipt can be days old.
import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { refuseTillRead } from '@/lib/till-read-auth';
import { findSale, parseReceiptLabel } from '@/lib/returns';

export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get('companyId');
  const raw = req.nextUrl.searchParams.get('label') ?? '';
  if (!companyId || !parseReceiptLabel(raw)) return Response.json({ error: 'bad_request' }, { status: 400 });
  const refused = await refuseTillRead(req, companyId);
  if (refused) return refused;

  const found = await findSale(createServerClient(), companyId, raw);
  if (found.state === 'failed') return Response.json({ error: 'read failed' }, { status: 500 });
  return Response.json({ sale: found.state === 'found' ? found.sale : null });
}

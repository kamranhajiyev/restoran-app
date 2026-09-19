// Setting a sex's printer IP from the till itself.
//
// Admin → Sexlər is the other place to do it, but a till opened with only its
// terminal link has no way into admin, and the printer is plugged in next to
// the till, not next to the owner. Only the IP: naming, adding and deleting
// sexes stay in admin.

import { NextRequest } from 'next/server';
import { createServerClient, verifySellerToken } from '@/lib/supabase-server';

// The same check components/StationsPanel.tsx makes before saving.
function isValidIp(ip: string): boolean {
  const parts = ip.split('.');
  return parts.length === 4 && parts.every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

export async function POST(req: NextRequest) {
  const { companyId, token, stationId, ip } = (await req.json()) as {
    companyId?: string;
    token?: string;
    stationId?: string;
    ip?: string | null;
  };
  if (!companyId || !stationId) return Response.json({ ok: false }, { status: 400 });
  const next = ip?.trim() || null;
  if (next !== null && !isValidIp(next)) {
    return Response.json({ ok: false, error: 'bad ip' }, { status: 400 });
  }
  if (!(await verifySellerToken(companyId, token ?? ''))) {
    return Response.json({ ok: false, error: 'revoked' }, { status: 403 });
  }

  const db = createServerClient();
  const { data, error } = await db.from('stations')
    .update({ printer_ip: next })
    .eq('id', stationId)
    .eq('company_id', companyId)
    .select('id');
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  if (!data?.length) return Response.json({ ok: false, error: 'not found' }, { status: 404 });
  return Response.json({ ok: true });
}

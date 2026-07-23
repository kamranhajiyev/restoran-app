import { NextRequest } from 'next/server';
import { createServerClient, verifySellerToken } from '@/lib/supabase-server';

// Public: verify a staff PIN for a company without requiring a Supabase session.
// Uses verify_staff_pin_for_company RPC (service role, bypasses RLS).
export async function POST(req: NextRequest) {
  const { companyId, pin, token, deviceId } = await req.json();
  if (!companyId || !pin) return Response.json({ ok: false, error: 'network' }, { status: 400 });
  if (!(await verifySellerToken(companyId, token))) return Response.json({ ok: false, error: 'revoked' }, { status: 403 });

  const db = createServerClient();
  const { data, error } = await db.rpc('verify_staff_pin_for_company', {
    p_company_id: companyId,
    p_pin: pin,
    p_device_id: deviceId ?? '',
  });

  if (error || !data) return Response.json({ ok: false, error: 'network' });
  return Response.json(data);
}

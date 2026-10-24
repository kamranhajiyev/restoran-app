import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { refuseTillRead } from '@/lib/till-read-auth';

// Public: returns active staff list for a company.
// Called by the public seller terminal which has no Supabase auth session.
// No PINs, except a manager's approval hash: the till checks a manager's PIN
// with it when offline (lib/till-rules, 20261029_till_permissions.sql).
// The company's till rules ride along, so the browser till needs no extra
// request for them.
export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get('companyId');
  if (!companyId) return Response.json({ error: 'missing companyId' }, { status: 400 });
  const refused = await refuseTillRead(req, companyId);
  if (refused) return refused;

  const db = createServerClient();
  const [{ data, error }, company] = await Promise.all([
    db.from('staff')
      .select('id, name, active, role, approve_hash, created_at')
      .eq('company_id', companyId)
      .order('created_at'),
    db.from('companies').select('till_rules').eq('id', companyId).maybeSingle(),
  ]);

  // A 500, not an empty list: the exe saves this list over its own, and an
  // empty one left nobody able to sign in with a PIN.
  if (error) return Response.json({ staff: [], error: error.message }, { status: 500 });
  return Response.json({
    staff: (data ?? []).map(s => ({
      id: s.id, name: s.name, active: s.active, createdAt: s.created_at,
      role: s.role ?? 'seller',
      approveHash: s.role === 'manager' && s.active ? s.approve_hash ?? undefined : undefined,
    })),
    // Left out when the read failed: the till keeps the rules it has.
    ...(company.error ? {} : { tillRules: company.data?.till_rules ?? null }),
  });
}

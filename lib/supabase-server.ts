import { createClient } from '@supabase/supabase-js';

export function createServerClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function verifyToken(token: string) {
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data: { user }, error } = await anon.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

export async function requireSuperadmin(req: Request): Promise<{ id: string } | Response> {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await verifyToken(token);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createServerClient();
  const { data: profile } = await db.from('profiles').select('role, active').eq('id', user.id).single();
  if (profile?.role !== 'superadmin') return Response.json({ error: 'Forbidden' }, { status: 403 });
  if (profile.active === false) return Response.json({ error: 'Hesab deaktivdir' }, { status: 403 });

  return { id: user.id };
}

export async function requireAuth(req: Request): Promise<{ id: string; role: string; companyId: string | null } | Response> {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await verifyToken(token);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createServerClient();
  const { data: profile } = await db.from('profiles').select('role, company_id, active').eq('id', user.id).single();
  if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (profile.active === false) return Response.json({ error: 'Hesab deaktivdir' }, { status: 403 });

  return { id: user.id, role: profile.role, companyId: profile.company_id ?? null };
}

// Public seller terminal auth: confirm the URL token still belongs to an active company.
// Rotating the token in admin ("Linki yenilə") immediately invalidates old sessions here,
// and prevents a leaked/forged companyId from being used against the public write endpoints.
// Returns the resolved company id (so callers rely on the token, not a client-supplied id).
export async function verifySellerToken(companyId: string, token: string): Promise<string | null> {
  if (!companyId || !token) return null;
  const db = createServerClient();
  const { data } = await db
    .from('companies')
    .select('id')
    .eq('id', companyId)
    .eq('seller_token', token)
    .eq('active', true)
    .is('trashed_at', null)
    .maybeSingle();
  return data?.id ?? null;
}

// The roles an owner is allowed to create and manage inside their own company.
// Never 'owner' or 'superadmin': an owner who could mint either would escape their
// own company.
export const OWNER_MANAGED_ROLES = ['seller', 'employee'] as const;

// Owners may manage only seller/employee accounts inside their own company.
export async function ownerManages(callerCompanyId: string | null, targetId: string): Promise<boolean> {
  if (!callerCompanyId) return false;
  const db = createServerClient();
  const { data } = await db.from('profiles').select('role, company_id').eq('id', targetId).single();
  return !!data
    && (OWNER_MANAGED_ROLES as readonly string[]).includes(data.role)
    && data.company_id === callerCompanyId;
}

// A sex belongs to exactly one company. Confirming that before writing profiles.station_id
// stops an owner from attaching their employee to another company's sex.
export async function stationInCompany(stationId: string, companyId: string): Promise<boolean> {
  const db = createServerClient();
  const { data } = await db
    .from('stations')
    .select('id')
    .eq('id', stationId)
    .eq('company_id', companyId)
    .maybeSingle();
  return !!data;
}

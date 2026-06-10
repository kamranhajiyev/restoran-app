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
  const { data: profile } = await db.from('profiles').select('role').eq('id', user.id).single();
  if (profile?.role !== 'superadmin') return Response.json({ error: 'Forbidden' }, { status: 403 });

  return { id: user.id };
}

export async function requireAuth(req: Request): Promise<{ id: string; role: string; companyId: string | null } | Response> {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await verifyToken(token);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createServerClient();
  const { data: profile } = await db.from('profiles').select('role, company_id').eq('id', user.id).single();
  if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  return { id: user.id, role: profile.role, companyId: profile.company_id ?? null };
}

// Owners may manage only seller accounts inside their own company.
export async function ownerManages(callerCompanyId: string | null, targetId: string): Promise<boolean> {
  if (!callerCompanyId) return false;
  const db = createServerClient();
  const { data } = await db.from('profiles').select('role, company_id').eq('id', targetId).single();
  return !!data && data.role === 'seller' && data.company_id === callerCompanyId;
}

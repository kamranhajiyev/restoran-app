import { NextRequest } from 'next/server';
import { createServerClient, requireSuperadmin } from '@/lib/supabase-server';

export async function GET(req: NextRequest) {
  const auth = await requireSuperadmin(req);
  if (auth instanceof Response) return auth;

  const db = createServerClient();
  const { data, error } = await db.from('profiles').select('*').order('created_at');
  if (error) return Response.json([]);
  return Response.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const auth = await requireSuperadmin(req);
  if (auth instanceof Response) return auth;

  const { username, password, name, role, companyId } = await req.json();
  const db = createServerClient();

  const { data: authUser, error: authError } = await db.auth.admin.createUser({
    email: `${username}@restoran.internal`,
    password,
    email_confirm: true,
  });

  if (authError) return Response.json({ error: authError.message }, { status: 500 });

  const { error: profileError } = await db.from('profiles').insert({
    id: authUser.user.id,
    username,
    name,
    role,
    company_id: companyId ?? null,
  });

  if (profileError) {
    await db.auth.admin.deleteUser(authUser.user.id);
    return Response.json({ error: profileError.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}

import { NextRequest } from 'next/server';
import { createServerClient, requireAuth } from '@/lib/supabase-server';

// Superadmin sees/creates everything; owners are limited to seller accounts
// inside their own company.
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'superadmin' && auth.role !== 'owner') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = createServerClient();
  let q = db.from('profiles').select('*').order('created_at');
  if (auth.role === 'owner') {
    if (!auth.companyId) return Response.json([]);
    q = q.eq('company_id', auth.companyId);
  }
  const { data, error } = await q;
  if (error) return Response.json([]);
  return Response.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'superadmin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { username, password, name } = body;
  const role = body.role;
  const companyId = body.companyId;

  if (!/^[a-z0-9_.-]{2,30}$/i.test(username ?? '')) {
    return Response.json({ error: 'İstifadəçi adı yanlış formatdadır' }, { status: 400 });
  }

  const db = createServerClient();

  const { data: existing } = await db.from('profiles').select('id').eq('username', username).maybeSingle();
  if (existing) {
    return Response.json({ error: 'Bu istifadəçi adı artıq mövcuddur' }, { status: 400 });
  }

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

import { NextRequest } from 'next/server';
import { createServerClient, requireAuth, stationInCompany, OWNER_MANAGED_ROLES } from '@/lib/supabase-server';

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
  if (auth.role !== 'superadmin' && auth.role !== 'owner') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { username, password, name } = body;
  const role = body.role;
  let stationId: string | null = body.stationId ?? null;

  // An owner creates staff for their OWN company only, and may not mint an owner or
  // a superadmin. Both are read off the caller's own profile rather than the body,
  // so a forged companyId can't place an account somewhere else.
  let companyId: string | null;
  if (auth.role === 'owner') {
    if (!(OWNER_MANAGED_ROLES as readonly string[]).includes(role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!auth.companyId) return Response.json({ error: 'Şirkət tapılmadı' }, { status: 400 });
    companyId = auth.companyId;
  } else {
    companyId = body.companyId ?? null;
  }

  if (!/^[a-z0-9_.-]{2,30}$/i.test(username ?? '')) {
    return Response.json({ error: 'İstifadəçi adı yanlış formatdadır' }, { status: 400 });
  }

  // An employee with no sex would log in to a blank screen — there is nothing for
  // the prep screen to filter by.
  if (role === 'employee') {
    if (!stationId) return Response.json({ error: 'Sex seçilməyib' }, { status: 400 });
    if (!companyId || !(await stationInCompany(stationId, companyId))) {
      return Response.json({ error: 'Sex tapılmadı' }, { status: 400 });
    }
  } else {
    stationId = null;   // only employees are tied to a sex
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
    station_id: stationId,
  });

  if (profileError) {
    await db.auth.admin.deleteUser(authUser.user.id);
    return Response.json({ error: profileError.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}

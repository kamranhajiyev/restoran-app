import { createServerClient, ownerManages, requireAuth } from '@/lib/supabase-server';

export async function PATCH(req: Request, ctx: RouteContext<'/api/users/[id]'>) {
  const { id } = await ctx.params;
  const caller = await requireAuth(req);
  if (caller instanceof Response) return caller;

  // Superadmin edits anyone; owners edit their own company's sellers; any user edits themselves
  const managesTarget = caller.role === 'superadmin'
    || (caller.role === 'owner' && await ownerManages(caller.companyId, id));
  if (!managesTarget && caller.id !== id) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { name, password, username, active } = await req.json();
  const db = createServerClient();

  if (username !== undefined) {
    if (!/^[a-z0-9_.-]{2,30}$/i.test(username ?? '')) {
      return Response.json({ error: 'İstifadəçi adı yanlış formatdadır' }, { status: 400 });
    }
    const { data: existing } = await db.from('profiles').select('id').eq('username', username).neq('id', id).maybeSingle();
    if (existing) {
      return Response.json({ error: 'Bu istifadəçi adı artıq mövcuddur' }, { status: 400 });
    }
  }

  // Self-edits can't change active status — only a manager can
  const profileUpdates: Record<string, unknown> = {};
  if (name !== undefined) profileUpdates.name = name;
  if (username !== undefined) profileUpdates.username = username;
  if (active !== undefined && managesTarget) profileUpdates.active = active;

  if (Object.keys(profileUpdates).length > 0) {
    const { error } = await db.from('profiles').update(profileUpdates).eq('id', id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }

  if (password) {
    const { error } = await db.auth.admin.updateUserById(id, { password });
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }

  if (username) {
    await db.auth.admin.updateUserById(id, { email: `${username}@restoran.internal` });
  }

  return Response.json({ ok: true });
}

export async function DELETE(req: Request, ctx: RouteContext<'/api/users/[id]'>) {
  const { id } = await ctx.params;
  const caller = await requireAuth(req);
  if (caller instanceof Response) return caller;
  const allowed = caller.role === 'superadmin'
    || (caller.role === 'owner' && await ownerManages(caller.companyId, id));
  if (!allowed) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const db = createServerClient();
  const { error } = await db.auth.admin.deleteUser(id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

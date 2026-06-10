import { createServerClient, requireAuth, requireSuperadmin } from '@/lib/supabase-server';

export async function PATCH(req: Request, ctx: RouteContext<'/api/users/[id]'>) {
  const { id } = await ctx.params;
  const caller = await requireAuth(req);
  if (caller instanceof Response) return caller;

  // Only superadmin can edit others; any user can edit themselves
  if (caller.role !== 'superadmin' && caller.id !== id) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { name, password, username, active } = await req.json();
  const db = createServerClient();

  // Only superadmin can change role or active status
  const profileUpdates: Record<string, unknown> = {};
  if (name !== undefined) profileUpdates.name = name;
  if (username !== undefined) profileUpdates.username = username;
  if (active !== undefined && caller.role === 'superadmin') profileUpdates.active = active;

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
  const caller = await requireSuperadmin(req);
  if (caller instanceof Response) return caller;

  const db = createServerClient();
  const { error } = await db.auth.admin.deleteUser(id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

// "Bax" on /superadmin: the superadmin opens a restaurant's admin as its owner.
// The server mints a one-time login code for the owner (generateLink sends no
// email, it only makes the code) and the browser signs in with it, so the
// superadmin sees exactly what the owner sees. Only an owner, only of a live
// restaurant, and never without a row in view_as_events.
import type { SupabaseClient } from '@supabase/supabase-js';

export type ViewAsResult =
  | { error: string; status: number }
  | { tokenHash: string; ownerName: string; companyName: string };

export async function mintViewAs(
  db: SupabaseClient,
  superadminId: string,
  companyId: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<ViewAsResult> {
  if (!companyId) return { error: 'Şirkət seçilməyib', status: 400 };

  const { data: company, error: cErr } = await db
    .from('companies').select('id, name, active, trashed_at').eq('id', companyId).maybeSingle();
  if (cErr) return { error: cErr.message, status: 500 };
  if (!company) return { error: 'Şirkət tapılmadı', status: 404 };
  // The owner's own login is refused for a switched-off restaurant, so this one would be too.
  if (!company.active || company.trashed_at) return { error: 'Şirkət deaktivdir', status: 400 };

  const { data: owners, error: oErr } = await db
    .from('profiles').select('id, name, role, active').eq('company_id', companyId).eq('role', 'owner');
  if (oErr) return { error: oErr.message, status: 500 };
  const owner = (owners ?? []).find(o => o.role === 'owner' && o.active !== false);
  if (!owner) return { error: 'Bu şirkətin aktiv admin hesabı yoxdur', status: 400 };

  // The login email follows the username, so read it rather than rebuild it.
  const { data: authUser, error: uErr } = await db.auth.admin.getUserById(owner.id);
  if (uErr || !authUser.user?.email) return { error: uErr?.message ?? 'Hesab tapılmadı', status: 500 };

  // Logged before the code exists: a visit nobody can trace never happens.
  const { error: logErr } = await db.from('view_as_events').insert({
    superadmin_id: superadminId,
    owner_id: owner.id,
    company_id: companyId,
    ip: meta.ip,
    user_agent: meta.userAgent,
  });
  if (logErr) return { error: logErr.message, status: 500 };

  const { data: link, error: lErr } = await db.auth.admin.generateLink({ type: 'magiclink', email: authUser.user.email });
  const tokenHash = link?.properties?.hashed_token;
  if (lErr || !tokenHash) return { error: lErr?.message ?? 'Giriş kodu yaradılmadı', status: 500 };

  return { tokenHash, ownerName: owner.name, companyName: company.name };
}

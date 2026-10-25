// The owner login for a new company, made from a script instead of superadmin.
// The same steps as POST /api/users: an auth user with <username>@restoran.internal,
// then its profile; a profile that fails takes the auth user back out.
import type { SupabaseClient } from '@supabase/supabase-js';

export const USERNAME_RULE = /^[a-z0-9_.-]{2,30}$/i;

export type OwnerInput = { slug: string; username: string; password: string; name?: string };

/** Creates the owner, or says why not. Nothing is left behind on a refusal. */
export async function createOwner(db: SupabaseClient, input: OwnerInput): Promise<{ error: string } | { userId: string; companyName: string }> {
  const { slug, username, password } = input;
  if (!USERNAME_RULE.test(username)) return { error: 'Username: 2-30 letters, digits, . _ -' };
  if (password.length < 6) return { error: 'Password: at least 6 characters' };

  const { data: company, error: cErr } = await db.from('companies').select('id, name').eq('slug', slug).maybeSingle();
  if (cErr) return { error: `Company read failed: ${cErr.message}` };
  if (!company) return { error: `No company with slug "${slug}"` };

  // A failed read must stop here, not look like "no owner yet" or "name free".
  const [owners, taken] = await Promise.all([
    db.from('profiles').select('username').eq('company_id', company.id).eq('role', 'owner'),
    db.from('profiles').select('id').eq('username', username).maybeSingle(),
  ]);
  if (owners.error || taken.error) return { error: `Profile read failed: ${(owners.error ?? taken.error)!.message}` };
  if (owners.data?.length) return { error: `${company.name} already has an owner: ${owners.data.map(o => o.username).join(', ')}` };
  if (taken.data) return { error: `Username "${username}" is taken` };

  const { data: auth, error: aErr } = await db.auth.admin.createUser({
    email: `${username}@restoran.internal`, password, email_confirm: true,
  });
  if (aErr || !auth.user) return { error: `Login failed: ${aErr?.message}` };

  const { error: pErr } = await db.from('profiles').insert({
    id: auth.user.id, username, name: input.name ?? company.name, role: 'owner', company_id: company.id, station_id: null,
  });
  if (pErr) {
    await db.auth.admin.deleteUser(auth.user.id);
    return { error: `Profile failed: ${pErr.message} (login taken back out)` };
  }
  return { userId: auth.user.id, companyName: company.name };
}

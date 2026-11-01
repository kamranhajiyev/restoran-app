// One owner, several məkans (20261104_company_groups.sql). The owner of a main
// company logs in once; the header lists it and the companies inside it, and
// picking one mints a one-time login code for that company's owner, the same
// way "Bax" does (lib/view-as). Only the main company's owner may switch: a
// child's own login, handed to that məkan's manager, sees no other məkan.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface Venue { id: string; name: string }

type Result<T> = { error: string; status: number } | T;

type Company = { id: string; name: string; active: boolean; trashed_at: string | null; expires_at: string | null; parent_id: string | null };
const COMPANY_COLS = 'id, name, active, trashed_at, expires_at, parent_id';

function live(c: Company): boolean {
  return c.active && !c.trashed_at && !(c.expires_at && new Date(c.expires_at) < new Date());
}

/** The caller's main company, or why they may not switch. */
async function mainCompany(db: SupabaseClient, userId: string): Promise<Result<{ company: Company }>> {
  const { data: profile, error: pErr } = await db
    .from('profiles').select('role, active, company_id').eq('id', userId).maybeSingle();
  if (pErr) return { error: pErr.message, status: 500 };
  if (!profile || profile.role !== 'owner' || profile.active === false || !profile.company_id) {
    return { error: 'Yalnız admin keçid edə bilər', status: 403 };
  }
  const { data: company, error: cErr } = await db
    .from('companies').select(COMPANY_COLS).eq('id', profile.company_id).maybeSingle();
  if (cErr) return { error: cErr.message, status: 500 };
  if (!company || !live(company)) return { error: 'Şirkət deaktivdir', status: 403 };
  if (company.parent_id) return { error: 'Keçid yalnız əsas məkanın hesabından olur', status: 403 };
  return { company };
}

/** The main company first, then the live companies inside it. Empty when there are none. */
export async function venuesFor(db: SupabaseClient, userId: string): Promise<Result<{ venues: Venue[] }>> {
  const main = await mainCompany(db, userId);
  // A child's login is not an error, it just has nowhere to go.
  if ('error' in main) return main.status === 403 ? { venues: [] } : main;

  const { data, error } = await db
    .from('companies').select(COMPANY_COLS).eq('parent_id', main.company.id).order('name');
  if (error) return { error: error.message, status: 500 };
  const children = (data as Company[] ?? []).filter(live);
  if (!children.length) return { venues: [] };
  return { venues: [main.company, ...children].map(c => ({ id: c.id, name: c.name })) };
}

/** A one-time login code for the owner of a company inside the caller's main one. */
export async function mintSwitch(
  db: SupabaseClient, userId: string, targetId: string,
): Promise<Result<{ tokenHash: string; companyName: string }>> {
  if (!targetId) return { error: 'Məkan seçilməyib', status: 400 };
  const main = await mainCompany(db, userId);
  if ('error' in main) return main;

  const { data: target, error: tErr } = await db
    .from('companies').select(COMPANY_COLS).eq('id', targetId).maybeSingle();
  if (tErr) return { error: tErr.message, status: 500 };
  if (!target || target.parent_id !== main.company.id) return { error: 'Bu məkan sizin deyil', status: 403 };
  if (!live(target)) return { error: 'Məkan deaktivdir', status: 400 };

  const { data: owners, error: oErr } = await db
    .from('profiles').select('id, role, active').eq('company_id', target.id).eq('role', 'owner');
  if (oErr) return { error: oErr.message, status: 500 };
  const owner = (owners ?? []).find(o => o.role === 'owner' && o.active !== false);
  if (!owner) return { error: 'Bu məkanın admin hesabı yoxdur', status: 400 };

  const { data: authUser, error: uErr } = await db.auth.admin.getUserById(owner.id);
  if (uErr || !authUser.user?.email) return { error: uErr?.message ?? 'Hesab tapılmadı', status: 500 };

  const { data: link, error: lErr } = await db.auth.admin.generateLink({ type: 'magiclink', email: authUser.user.email });
  const tokenHash = link?.properties?.hashed_token;
  if (lErr || !tokenHash) return { error: lErr?.message ?? 'Giriş kodu yaradılmadı', status: 500 };

  return { tokenHash, companyName: target.name };
}

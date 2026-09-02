import { supabase } from './supabase';
import { Role } from '@/types';

const AUTH_KEY = 'restoran_auth';
const ADMIN_LOCK_KEY = 'restoran_admin_locked';

// Stepping from admin down to the till locks the panel behind the owner's own
// password, so a cashier left alone at the terminal cannot walk back up into it.
// The gate lives on /admin rather than on the till's "Admin" button because the
// desktop shell still honours Alt+← and a reload — both of which would walk
// straight past a button-level prompt.
//
// localStorage, not sessionStorage: restarting the desktop app would otherwise
// clear the lock and drop whoever is at the terminal straight into the panel,
// since the login is already cached. Only the password — or a fresh login —
// lifts it.
export function lockAdmin() {
  try { localStorage.setItem(ADMIN_LOCK_KEY, '1'); } catch { /* private mode */ }
}

export function unlockAdmin() {
  try { localStorage.removeItem(ADMIN_LOCK_KEY); } catch { /* private mode */ }
}

export function isAdminLocked(): boolean {
  try { return localStorage.getItem(ADMIN_LOCK_KEY) === '1'; } catch { return false; }
}

export interface Session {
  id: string;
  name: string;
  role: Role;
  companyId: string | null;
  companyName: string | null;
  expiresAt: string | null;
  // Which sex this employee works. Null for every other role.
  stationId: string | null;
}

export type LoginResult = { session: Session } | { error: 'invalid' | 'inactive' };

export async function login(username: string, password: string): Promise<LoginResult> {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: `${username.trim()}@restoran.internal`,
      password,
    });

    if (error || !data.user) return { error: 'invalid' };

    const { data: profile } = await supabase
      .from('profiles')
      .select('name, role, company_id, active, station_id')
      .eq('id', data.user.id)
      .single();

    if (!profile) return { error: 'invalid' };
    if (!profile.active) return { error: 'inactive' };

    let companyName: string | null = null;
    let expiresAt: string | null = null;

    if (profile.company_id) {
      const { data: co } = await supabase
        .from('companies')
        .select('name, expires_at, active, trashed_at')
        .eq('id', profile.company_id)
        .single();
      if (!co || !co.active || co.trashed_at) return { error: 'inactive' };
      companyName = co.name ?? null;
      expiresAt = co.expires_at ?? null;
    }

    const session: Session = {
      id: data.user.id,
      name: profile.name,
      role: profile.role as Role,
      companyId: profile.company_id ?? null,
      companyName,
      expiresAt,
      stationId: profile.station_id ?? null,
    };

    localStorage.setItem(AUTH_KEY, JSON.stringify(session));

    // Fire-and-forget: the audit trail must never block or fail a login.
    if (data.session?.access_token) {
      fetch('/api/login-events', {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      }).catch(() => {});
    }

    return { session };
  } catch {
    return { error: 'invalid' };
  }
}

// Where a role lands after login. One function because the landing page and the
// login page both need it, and a role missing from one of them would silently
// drop that user onto the till.
export function homeFor(session: Pick<Session, 'role' | 'stationId'>): string {
  switch (session.role) {
    case 'superadmin': return '/superadmin';
    case 'owner':      return '/admin';
    // A sex was deleted out from under this employee. /station has nothing to show,
    // so send them somewhere that explains itself rather than to a blank screen.
    case 'employee':   return session.stationId ? '/station' : '/no-station';
    default:           return '/seller';
  }
}

export function getSession(): Session | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(AUTH_KEY);
  return raw ? JSON.parse(raw) : null;
}

// Patch the cached session in place. An owner renaming their own venue would
// otherwise keep seeing the old name in the header until the next login.
export function updateSession(patch: Partial<Session>) {
  const stored = getSession();
  if (!stored) return;
  localStorage.setItem(AUTH_KEY, JSON.stringify({ ...stored, ...patch }));
}

export function logout() {
  supabase.auth.signOut();
  localStorage.removeItem(AUTH_KEY);
  // Signing in again is proof enough — don't make the next owner face the lock.
  unlockAdmin();
}

// Use inside onAuthStateChange callbacks instead of logout().
// logout() calls signOut() which fires SIGNED_OUT which retriggers the callback → infinite loop.
export function clearLocalSession() {
  localStorage.removeItem(AUTH_KEY);
  unlockAdmin();
}

export async function validateSession(session: Session): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return false;

    // The auth token is shared by every tab of this browser. Logging into a
    // different account in another tab replaces it — this tab would then act
    // on its old company with the new account's permissions (RLS errors at
    // best, cross-company writes at worst). Treat that as an invalid session.
    if (data.user.id !== session.id) return false;

    const { data: profile } = await supabase
      .from('profiles')
      .select('active, station_id')
      .eq('id', session.id)
      .single();
    if (!profile?.active) return false;

    // An owner can move an employee to another sex — or delete the sex out from
    // under them — while they are logged in. The cached session would go on
    // showing the old sex's food, so re-read it here the way expiresAt is.
    if ((profile.station_id ?? null) !== session.stationId) {
      const stored = getSession();
      if (stored) {
        stored.stationId = profile.station_id ?? null;
        localStorage.setItem(AUTH_KEY, JSON.stringify(stored));
      }
    }

    if (session.companyId) {
      const { data: co } = await supabase
        .from('companies')
        .select('active, expires_at, trashed_at')
        .eq('id', session.companyId)
        .single();
      if (!co?.active || co.trashed_at) return false;
      if (co.expires_at && new Date(co.expires_at) < new Date()) return false;
      // Write fresh expiry back so the banner always reflects the DB value
      const stored = getSession();
      if (stored) {
        stored.expiresAt = co.expires_at ?? null;
        localStorage.setItem(AUTH_KEY, JSON.stringify(stored));
      }
    }

    return true;
  } catch {
    return false;
  }
}

// The browser half of "Bax" (server half: lib/view-as). The superadmin's own
// logins are kept aside, the browser signs in as the owner, and /superadmin puts
// them back. The way back is a page load of /superadmin, not a call from the
// admin page: admin, seller and station each log out when the signed-in user
// changes under them, and would race the restore.
import { supabase } from './supabase';
import { VIEW_AS_KEY, forgetTill, forgetViewAs, getSession, logout, putSession, sessionFor, unlockAdmin, type Session } from './auth';

interface Saved {
  accessToken: string;
  refreshToken: string;
  session: Session;
  // Whose restaurant is open, for the yellow bar.
  label: string;
}

function readSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(VIEW_AS_KEY);
    return raw ? JSON.parse(raw) as Saved : null;
  } catch { return null; }
}

/** The restaurant being looked at, or null when this is nobody's visit. */
export function viewAsLabel(): string | null {
  if (typeof window === 'undefined') return null;
  return readSaved()?.label ?? null;
}

export async function startViewAs(companyId: string): Promise<string | null> {
  const self = getSession();
  const { data: { session: auth } } = await supabase.auth.getSession();
  if (!self || self.role !== 'superadmin' || !auth) return 'Yenidən daxil olun';

  const res = await fetch('/api/view-as', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.access_token}` },
    body: JSON.stringify({ companyId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.tokenHash) return body.error ?? 'Xəta baş verdi';

  const saved: Saved = {
    accessToken: auth.access_token,
    refreshToken: auth.refresh_token,
    session: self,
    label: `${body.companyName} · ${body.ownerName}`,
  };
  localStorage.setItem(VIEW_AS_KEY, JSON.stringify(saved));

  const { data, error } = await supabase.auth.verifyOtp({ token_hash: body.tokenHash, type: 'magiclink' });
  if (error || !data.user) {
    await backToSuperadmin();
    return error?.message ?? 'Daxil olmaq alınmadı';
  }
  const owner = await sessionFor(data.user.id);
  if ('error' in owner) {
    await backToSuperadmin();
    return 'Hesab deaktivdir';
  }
  // The superadmin's own device: no till lock from an earlier visit.
  unlockAdmin();
  forgetTill();
  return null;
}

/**
 * Puts the superadmin's logins back if a visit is open. True when the device is
 * the superadmin again (or never left), false when it had to log out instead.
 */
export async function backToSuperadmin(): Promise<boolean> {
  const saved = readSaved();
  if (!saved) return true;
  const { error } = await supabase.auth.setSession({
    access_token: saved.accessToken,
    refresh_token: saved.refreshToken,
  });
  if (error) {
    // logout() signs out this device only, so the owner's own tills stay in.
    logout();
    return false;
  }
  putSession(saved.session);
  unlockAdmin();
  forgetTill();
  forgetViewAs();
  return true;
}

// The browser half of the məkan switch (server half: lib/switch-company). The
// main məkan's login is kept aside while this device is signed in as another
// məkan's owner, and picking the main one again puts it back. This device only:
// the tills of every məkan stay signed in as they were.
import { supabase } from './supabase';
import { HOME_KEY, forgetHome, forgetTill, getSession, logout, markSwitch, putSession, unmarkSwitch, sessionFor, type Session } from './auth';
import type { Venue } from './switch-company';

interface Home {
  accessToken: string;
  refreshToken: string;
  session: Session;
  venues: Venue[];
}

export type SwitchResult = { error: string | null; moved: boolean };

// The kept main login, only while this device is still on one of its məkans.
// Anything else is left over from someone else's visit and is dropped.
function readHome(self: Session): Home | null {
  let home: Home | null = null;
  try {
    const raw = localStorage.getItem(HOME_KEY);
    home = raw ? JSON.parse(raw) as Home : null;
  } catch { /* unreadable: treated as none */ }
  if (!home) return null;
  if (self.role === 'owner' && Array.isArray(home.venues) && home.venues.some(v => v.id === self.companyId)) return home;
  forgetHome();
  return null;
}

// The admin page logs out when the signed-in user changes under it; a switch
// changes it on purpose, so the page asks here first.
let switching = false;
export function isSwitching(): boolean { return switching; }

/**
 * The məkans this device can switch between, the main one first. Empty for
 * anyone else, and in the exe and the Android app: their till keeps its own
 * məkan's orders on the machine, and a switch would hand them to another.
 */
export async function loadVenues(): Promise<Venue[]> {
  const self = getSession();
  if (!self || self.role !== 'owner' || typeof window === 'undefined' || window.posNative) return [];
  const home = readHome(self);
  if (home) return home.venues;
  const { data: { session: auth } } = await supabase.auth.getSession();
  if (!auth) return [];
  try {
    const res = await fetch('/api/switch-company', { headers: { Authorization: `Bearer ${auth.access_token}` } });
    const body = await res.json().catch(() => ({}));
    return res.ok && Array.isArray(body.venues) ? body.venues : [];
  } catch { return []; }
}

/** Signs this device back in as the main məkan. False when it had to log out instead. */
async function goHome(home: Home): Promise<boolean> {
  const { data, error } = await supabase.auth.setSession({ access_token: home.accessToken, refresh_token: home.refreshToken });
  if (error || !data.session) {
    logout();
    return false;
  }
  putSession(home.session);
  forgetHome();
  forgetTill();
  return true;
}

/**
 * Opens another məkan on this device. `moved` says the signed-in login changed
 * (even on an error, when it fell back to the main one), so the page must reload.
 */
export async function switchVenue(targetId: string, venues: Venue[]): Promise<SwitchResult> {
  switching = true;
  markSwitch();
  const r = await doSwitch(targetId, venues);
  // A moved login is followed by a reload; until then the page stays quiet.
  // A switch that never moved must not keep other tabs from logging out.
  if (!r.moved) { switching = false; unmarkSwitch(); }
  return r;
}

async function doSwitch(targetId: string, venues: Venue[]): Promise<SwitchResult> {
  const self = getSession();
  if (!self) return { error: 'Yenidən daxil olun', moved: false };
  if (self.companyId === targetId) return { error: null, moved: false };

  let home = readHome(self);
  let moved = false;

  if (home && home.session.companyId === targetId) {
    const ok = await goHome(home);
    return { error: ok ? null : 'Yenidən daxil olun', moved: true };
  }

  if (home) {
    // Only the main login may open another məkan, so it goes back first.
    const { data, error } = await supabase.auth.setSession({ access_token: home.accessToken, refresh_token: home.refreshToken });
    if (error || !data.session) {
      logout();
      return { error: 'Yenidən daxil olun', moved: true };
    }
    putSession(home.session);
    forgetHome();
    moved = true;
    home = { ...home, accessToken: data.session.access_token, refreshToken: data.session.refresh_token };
  } else {
    const { data: { session: auth } } = await supabase.auth.getSession();
    if (!auth) return { error: 'Yenidən daxil olun', moved: false };
    home = { accessToken: auth.access_token, refreshToken: auth.refresh_token, session: self, venues };
  }

  let body: { tokenHash?: string; error?: string } = {};
  try {
    const res = await fetch('/api/switch-company', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${home.accessToken}` },
      body: JSON.stringify({ companyId: targetId }),
    });
    body = await res.json().catch(() => ({}));
    if (!res.ok) body.tokenHash = undefined;
  } catch { body = { error: 'İnternet yoxdur' }; }
  if (!body.tokenHash) return { error: body.error ?? 'Xəta baş verdi', moved };

  // Kept before the login changes, so a failure below can still go back.
  localStorage.setItem(HOME_KEY, JSON.stringify(home));

  const { data, error } = await supabase.auth.verifyOtp({ token_hash: body.tokenHash, type: 'magiclink' });
  if (error || !data.user) {
    await goHome(home);
    return { error: error?.message ?? 'Daxil olmaq alınmadı', moved: true };
  }
  const there = await sessionFor(data.user.id);
  if ('error' in there) {
    await goHome(home);
    return { error: 'Məkanın hesabı deaktivdir', moved: true };
  }
  forgetTill();

  // The audit trail, as on a typed login; never blocks the switch.
  if (data.session?.access_token) {
    fetch('/api/login-events', { method: 'POST', headers: { Authorization: `Bearer ${data.session.access_token}` } }).catch(() => {});
  }
  return { error: null, moved: true };
}

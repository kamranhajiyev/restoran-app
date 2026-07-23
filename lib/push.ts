// Web Push subscription, from the seller screen. A page cannot beep once its tab is
// hidden or the phone is locked; only an OS notification reaches a backgrounded waiter.
// This asks permission, registers the browser with the push service, and hands the
// subscription to the server (app/api/push-subscribe), which sends the "ready" alert.
import { supabase } from '@/lib/supabase';
import { getDeviceId } from '@/lib/store';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

export type PushState = 'unsupported' | 'ios-needs-install' | 'default' | 'granted' | 'denied';

// The push service wants the VAPID key as a Uint8Array, not the base64url string.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    && !(window as unknown as { MSStream?: unknown }).MSStream;
}

// iOS delivers Web Push only to a home-screen PWA, never to a Safari tab. Detect that
// so the UI can tell the waiter to "Add to Home Screen" instead of failing silently.
function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}

// What the enable button should show, without prompting for anything.
export function pushState(): PushState {
  if (typeof window === 'undefined') return 'unsupported';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    if (isIOS() && !isStandalone()) return 'ios-needs-install';
    return 'unsupported';
  }
  if (isIOS() && !isStandalone()) return 'ios-needs-install';
  return Notification.permission as PushState;
}

// Ask permission (if not already decided), subscribe, and register with the server.
// Returns the resulting state so the caller can update the banner. Safe to call again:
// an existing subscription is reused, and the server upserts by endpoint.
export async function subscribeToPush(
  companyId: string,
  token?: string,
): Promise<PushState> {
  const state = pushState();
  if (state === 'unsupported' || state === 'ios-needs-install' || state === 'denied') return state;
  if (!VAPID_PUBLIC_KEY) return 'unsupported';

  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();
  if (permission !== 'granted') return permission as PushState;

  // The /seller page registers the SW itself, but the tokenless terminal (/s/…) does
  // not — register on demand so `.ready` resolves instead of hanging there.
  if (!(await navigator.serviceWorker.getRegistration())) {
    await navigator.serviceWorker.register('/sw.js');
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription()
    ?? await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    });

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // Authed seller: attach the Supabase bearer so the server can trust the company.
  // Public terminal: pass the seller token instead (verified server-side).
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

  const res = await fetch('/api/push-subscribe', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      companyId,
      token,
      deviceId: getDeviceId(),
      subscription: sub.toJSON(),
    }),
  });
  if (!res.ok) throw new Error('subscribe failed');
  return 'granted';
}

// What an ended subscription closes, and when. One place, because the server
// (app/api/seller-token), the login, every page's session check and both
// banners have to agree on the same day.
//
//   · Admin (the owner's login) closes the moment expires_at passes.
//   · The till — terminal link, exe, APK, a seller or kitchen login — keeps
//     selling for TILL_GRACE_DAYS more days, then closes at the start of a
//     business day, never in the middle of one: a restaurant that forgot to pay
//     must not lose a dinner service, but must not sell for free forever either.
//   · The superadmin's "Bax" is never closed by the date: an expired restaurant
//     is exactly the one support has to look inside.

import { addDays, businessDay, businessDayStartUtc, DEFAULT_TZ, type CompanySettings } from './business-day';

export const TILL_GRACE_DAYS = 7;

export function subscriptionExpired(expiresAt: string | null | undefined, now: Date = new Date()): boolean {
  return !!expiresAt && new Date(expiresAt).getTime() < now.getTime();
}

/**
 * The instant the till closes: the start of the first business day after the
 * expiry day and TILL_GRACE_DAYS whole days more. Null when there is no expiry.
 */
export function tillLockAt(expiresAt: string | null | undefined, settings: CompanySettings): Date | null {
  if (!expiresAt) return null;
  const expiryDay = businessDay(expiresAt, settings);
  return businessDayStartUtc(addDays(expiryDay, TILL_GRACE_DAYS + 1), settings);
}

export function tillLocked(expiresAt: string | null | undefined, settings: CompanySettings, now: Date = new Date()): boolean {
  const at = tillLockAt(expiresAt, settings);
  return !!at && now.getTime() >= at.getTime();
}

/** A companies row's timezone and hours, as the business-day helpers want them. */
export function settingsFromRow(row: { timezone?: string | null; work_open?: string | null; work_close?: string | null }): CompanySettings {
  return {
    timezone: row.timezone || DEFAULT_TZ,
    workOpen: row.work_open || '00:00',
    workClose: row.work_close || '00:00',
  };
}

/** Who a login is, for the purpose of the date: admin closes first, the till later. */
export type Door = 'admin' | 'till';

export function doorFor(role: string): Door {
  return role === 'owner' ? 'admin' : 'till';
}

/** True when this door is shut by the date. Superadmin has no company, so never. */
export function closedByDate(
  door: Door,
  expiresAt: string | null | undefined,
  settings: CompanySettings,
  now: Date = new Date(),
): boolean {
  return door === 'admin' ? subscriptionExpired(expiresAt, now) : tillLocked(expiresAt, settings, now);
}

// ── The banner ──────────────────────────────────────────────────────────────
// Same words on admin and the till. `lockDay` is the last business day the till
// still opens, shown so nobody is surprised by the morning it does not.

export interface Banner { expired: boolean; text: string }

const BANNER_DAYS = 10;

function shortDate(day: string): string {
  const [y, m, d] = day.split('-');
  return `${d}.${m}.${y}`;
}

export function subscriptionBanner(
  expiresAt: string | null | undefined,
  settings: CompanySettings,
  now: Date = new Date(),
): Banner | null {
  if (!expiresAt) return null;
  const days = Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / 86400000);
  if (days > BANNER_DAYS) return null;
  if (!subscriptionExpired(expiresAt, now)) {
    return { expired: false, text: `Abunəliyinizin müddəti ${days} gün sonra bitir. Xidmətin fasiləsiz davam etməsi üçün ödənişi tamamlayın.` };
  }
  const lastDay = addDays(businessDay(expiresAt, settings), TILL_GRACE_DAYS);
  return {
    expired: true,
    text: `Abunəliyinizin müddəti bitib. Admin panel bağlıdır, kassa ${shortDate(lastDay)} tarixinə qədər işləyəcək.`,
  };
}

// ── Why the till will not open ──────────────────────────────────────────────
// The server answers 404 for all three, so tills built before these reasons
// existed still treat every one of them as "stop". Newer ones read `error`.

export type TillRefusal = 'invalid' | 'inactive' | 'expired';

export function tillRefusal(body: unknown): TillRefusal {
  const e = (body as { error?: unknown } | null)?.error;
  return e === 'inactive' || e === 'expired' ? e : 'invalid';
}

export const TILL_REFUSAL_TEXT: Record<TillRefusal, { title: string; hint: string }> = {
  invalid: { title: 'Bu keçid etibarsız', hint: 'Admindən yeni link alın' },
  inactive: { title: 'Məkan deaktiv edilib', hint: 'Zəhmət olmasa bizimlə əlaqə saxlayın' },
  expired: { title: 'Abunəliyin müddəti bitib', hint: 'Kassa ödənişdən sonra öz-özünə açılacaq' },
};

export const SUPPORT_URL = 'https://wa.me/994998989876';

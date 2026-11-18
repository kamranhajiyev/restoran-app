// What an ended subscription closes, and when (lib/subscription.ts), 2026-11-18.
//
// Before: admin closed at the expiry date, but the till — browser link, exe,
// APK — never closed at all, so an unpaid restaurant could sell for ever. The
// superadmin's "Bax" was thrown out of an expired account a second after it
// opened. The login said nothing about why. And a switched-off venue told the
// till "Bu keçid etibarsız", so they asked for a new link that would not help.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import {
  closedByDate, doorFor, subscriptionBanner, subscriptionExpired, tillLockAt, tillLocked, tillRefusal,
  TILL_GRACE_DAYS,
} from '@/lib/subscription';
import { DEFAULT_SETTINGS, type CompanySettings } from '@/lib/business-day';

// The superadmin's date picker saves noon, Baku time (app/superadmin/page.tsx).
const EXPIRES = '2026-11-18T08:00:00.000Z';
const BAKU = DEFAULT_SETTINGS; // midnight rollover
const LATE: CompanySettings = { timezone: 'Asia/Baku', workOpen: '10:00', workClose: '04:00' };

describe('admin closes on the date, the till after the grace days', () => {
  it('gives the till seven days after the expiry day, closing at the start of a business day', () => {
    expect(TILL_GRACE_DAYS).toBe(7);
    // Expiry day 18th; the till still opens through the 25th, closes as the 26th begins.
    expect(tillLockAt(EXPIRES, BAKU)!.toISOString()).toBe('2026-11-25T20:00:00.000Z'); // 26th 00:00 Baku
  });

  it('closes at the restaurant\'s own rollover, not midnight, when it works past it', () => {
    expect(tillLockAt(EXPIRES, LATE)!.toISOString()).toBe('2026-11-26T00:00:00.000Z'); // 26th 04:00 Baku
  });

  it('never closes in the middle of a business day', () => {
    const at = tillLockAt(EXPIRES, LATE)!;
    expect(tillLocked(EXPIRES, LATE, new Date(at.getTime() - 60_000))).toBe(false);
    expect(tillLocked(EXPIRES, LATE, at)).toBe(true);
  });

  it('shuts admin at the expiry, the till only later', () => {
    const dayAfter = new Date('2026-11-19T10:00:00Z');
    expect(subscriptionExpired(EXPIRES, dayAfter)).toBe(true);
    expect(closedByDate('admin', EXPIRES, BAKU, dayAfter)).toBe(true);
    expect(closedByDate('till', EXPIRES, BAKU, dayAfter)).toBe(false);
    expect(closedByDate('till', EXPIRES, BAKU, new Date('2026-11-27T10:00:00Z'))).toBe(true);
  });

  it('closes nothing without a date', () => {
    expect(closedByDate('admin', null, BAKU)).toBe(false);
    expect(closedByDate('till', null, BAKU)).toBe(false);
  });

  it('treats the owner as admin and every other login as the till', () => {
    expect(doorFor('owner')).toBe('admin');
    expect(doorFor('seller')).toBe('till');
    expect(doorFor('employee')).toBe('till');
  });

  it('tells them on the banner which day the till stops', () => {
    const b = subscriptionBanner(EXPIRES, BAKU, new Date('2026-11-19T10:00:00Z'))!;
    expect(b.expired).toBe(true);
    expect(b.text).toContain('25.11.2026');
    expect(subscriptionBanner(EXPIRES, BAKU, new Date('2026-11-14T10:00:00Z'))!.text).toContain('4 gün sonra bitir');
    expect(subscriptionBanner(EXPIRES, BAKU, new Date('2026-10-01T10:00:00Z'))).toBeNull();
  });
});

describe('the till says why it stopped', () => {
  it('reads the reason, and anything unknown is a wrong link', () => {
    expect(tillRefusal({ error: 'inactive' })).toBe('inactive');
    expect(tillRefusal({ error: 'expired' })).toBe('expired');
    expect(tillRefusal({ error: 'invalid' })).toBe('invalid');
    expect(tillRefusal(null)).toBe('invalid');
  });
});

// ── The server ──────────────────────────────────────────────────────────────

let row: Record<string, unknown> | null = null;
vi.mock('@/lib/supabase-server', () => {
  const q = { select: () => q, eq: () => q, is: () => q, maybeSingle: async () => ({ data: row }) };
  return { createServerClient: () => ({ from: () => q }), requireAuth: async () => new Response(null, { status: 401 }) };
});

import { GET } from '@/app/api/seller-token/route';

const ask = () => GET(new NextRequest('http://localhost/api/seller-token?slug=s&token=t'));
const company = (extra: Record<string, unknown>) => ({
  id: 'c1', name: 'Autotest', logo_url: null, brand_color: null, active: true,
  expires_at: null, timezone: 'Asia/Baku', work_open: '00:00', work_close: '00:00', ...extra,
});

describe('/api/seller-token', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('keeps the till open during the grace days', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-20T10:00:00Z'), toFake: ['Date'] });
    row = company({ expires_at: EXPIRES });
    const r = await ask();
    expect(r.status).toBe(200);
    expect((await r.json()).companyId).toBe('c1');
  });

  it('stops the till after them, saying why — still a 404 for older exes', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-27T10:00:00Z'), toFake: ['Date'] });
    row = company({ expires_at: EXPIRES });
    const r = await ask();
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'expired' });
  });

  it('says a switched-off venue is switched off, not that the link is wrong', async () => {
    row = company({ active: false });
    const r = await ask();
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'inactive' });
  });

  it('still calls a wrong link wrong', async () => {
    row = null;
    const r = await ask();
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'invalid' });
  });
});

// ── The screens ─────────────────────────────────────────────────────────────

describe('every screen uses the same rule', () => {
  const read = (p: string) => readFileSync(p, 'utf8');

  it('both banners take their words and days from lib/subscription', () => {
    for (const p of ['app/admin/page.tsx', 'app/seller/page.tsx']) {
      const src = read(p);
      expect(src).toMatch(/subscriptionBanner\(expiresAt, bizSettings\)/);
      expect(src).not.toMatch(/Sistemə giriş məhdudlaşdırıla bilər/);
    }
  });

  it('admin checks the admin door, the till and kitchen the till door', () => {
    expect(read('app/admin/page.tsx')).toMatch(/validateSession\(session, 'admin'\)/);
    expect(read('app/seller/page.tsx')).toMatch(/validateSession\(session, 'till'\)/);
    expect(read('app/station/page.tsx')).toMatch(/validateSession\(session, 'till'\)/);
  });

  it('"Bax" is not closed by the date', () => {
    expect(read('lib/view-as-session.ts')).toMatch(/sessionFor\(data\.user\.id, \{ viewing: true \}\)/);
    expect(read('lib/auth.ts')).toMatch(/!isViewingAs\(\) && closedByDate/);
  });

  it('the browser till and the exe/APK both show the stop screen with the reason', () => {
    expect(read('app/s/[slug]/[token]/page.tsx')).toMatch(/<TillRefused/);
    expect(read('app/seller/page.tsx')).toMatch(/<TillRefused reason=\{refused\}/);
  });
});

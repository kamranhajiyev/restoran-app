// The /api/public-* reads answered anyone who knew a company id — and the guest
// menu hands that id to every visitor. Found 2026-10-05: one request downloaded
// a restaurant's orders, online guests' phones and addresses included.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifySellerToken = vi.fn();
vi.mock('@/lib/supabase-server', () => ({ verifySellerToken: (...a: unknown[]) => verifySellerToken(...a) }));

import { refuseTillRead } from '@/lib/till-read-auth';
import { TILL_TOKEN_HEADER, tokenFromLink, withTillToken } from '@/lib/till-read-token';

const read = (token?: string) =>
  new Request('https://x.test/api/public-orders?companyId=c1', {
    headers: token ? { [TILL_TOKEN_HEADER]: token } : {},
  });

describe('a till read', () => {
  beforeEach(() => {
    verifySellerToken.mockReset();
    verifySellerToken.mockImplementation(async (c: string, t: string) => (c === 'c1' && (t === 'good' || t === 'fresh') ? c : null));
  });

  it('is refused with a wrong token', async () => {
    expect((await refuseTillRead(read('stolen'), 'c1'))?.status).toBe(403);
  });

  it('is refused with another company’s token', async () => {
    expect((await refuseTillRead(read('good'), 'c2'))?.status).toBe(403);
  });

  it('goes ahead with the till’s token', async () => {
    expect(await refuseTillRead(read('good'), 'c1')).toBeNull();
  });

  it('asks the database once a minute, not on every read', async () => {
    const t0 = 1_000_000_000;
    await refuseTillRead(read('fresh'), 'c1', t0);
    await refuseTillRead(read('fresh'), 'c1', t0 + 30_000);
    const before = verifySellerToken.mock.calls.length;
    await refuseTillRead(read('fresh'), 'c1', t0 + 30_000);
    expect(verifySellerToken.mock.calls.length).toBe(before);
    await refuseTillRead(read('fresh'), 'c1', t0 + 10 * 60_000);
    expect(verifySellerToken.mock.calls.length).toBe(before + 1);
  });

  it('without a token still works for old exes, until the switch is on', async () => {
    expect(await refuseTillRead(read(), 'c1')).toBeNull();
    expect((await refuseTillRead(read(), 'c1', Date.now(), true))?.status).toBe(401);
  });
});

describe('the till sends its token', () => {
  it('on a read, beside the caller’s own headers', () => {
    expect(withTillToken('/api/public-menu?companyId=c1', { a: '1' }, 'tok'))
      .toEqual({ a: '1', [TILL_TOKEN_HEADER]: 'tok' });
  });

  it('not on a write, which carries it in the body already', () => {
    expect(withTillToken('/api/add-order', { a: '1' }, 'tok')).toEqual({ a: '1' });
  });

  it('read from the link the exe saved', () => {
    expect(tokenFromLink(JSON.stringify({ companyId: 'c1', token: 'tok' }))).toBe('tok');
    expect(tokenFromLink('')).toBeNull();
    expect(tokenFromLink('not json')).toBeNull();
  });
});

describe('every /api/public-* route', () => {
  const dir = join(__dirname, '..', 'app', 'api');
  const routes = readdirSync(dir).filter(d => d.startsWith('public-'));

  it('checks the token before answering', () => {
    expect(routes.length).toBeGreaterThan(10);
    const unchecked = routes.filter(r =>
      !readFileSync(join(dir, r, 'route.ts'), 'utf8').includes('await refuseTillRead(req, companyId)'));
    expect(unchecked).toEqual([]);
  });
});

// The exe/APK used to wipe its stored link whenever the server said 404 — so a
// venue switched off for a day had to be set up again from scratch, and an
// expired one would have too. A link that is right but closed is now kept, and
// only a wrong link is forgotten (2026-11-18).

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/till-write', () => ({ apiBase: async () => 'https://x.test' }));

import { checkLink } from '@/lib/terminal-link';

function answer(status: number, body: string) {
  vi.stubGlobal('fetch', async () => new Response(body, { status }));
}

describe('checkLink on a refusal', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('a switched-off venue is refused, not invalid', async () => {
    answer(404, JSON.stringify({ error: 'inactive' }));
    expect(await checkLink('s', 't')).toEqual({ status: 'refused', reason: 'inactive' });
  });

  it('an expired one is refused, not invalid', async () => {
    answer(404, JSON.stringify({ error: 'expired' }));
    expect(await checkLink('s', 't')).toEqual({ status: 'refused', reason: 'expired' });
  });

  it('a wrong link is still invalid, as is a 404 from an older server', async () => {
    answer(404, JSON.stringify({ error: 'invalid' }));
    expect(await checkLink('s', 't')).toEqual({ status: 'invalid' });
    answer(404, 'Not found');
    expect(await checkLink('s', 't')).toEqual({ status: 'invalid' });
  });

  it('the exe forgets the link only when it is invalid', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('app/seller/page.tsx', 'utf8');
    const recheck = src.slice(src.indexOf('const recheck = useCallback'), src.indexOf("if (result.status === 'refused')"));
    expect(recheck).toMatch(/result\.status === 'invalid'\) \{\s*await clearLink\(\)/);
  });
});

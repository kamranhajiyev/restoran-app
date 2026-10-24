import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LINK_CHECK_MS } from '@/lib/link-check';

// An open terminal link asked the server every 40 s whether it was still
// valid: about 2,000 Vercel calls per till per day (usage review, 2026-10-14).

describe('the terminal link check', () => {
  it('runs every five minutes', () => {
    expect(LINK_CHECK_MS).toBe(5 * 60_000);
  });

  it('is the timer the link page uses, and focus still checks (once per half minute)', () => {
    const src = readFileSync('app/s/[slug]/[token]/page.tsx', 'utf8');
    expect(src).toMatch(/setInterval\(revalidate, LINK_CHECK_MS\)/);
    expect(src).toMatch(/addEventListener\('focus', onFocus\)/);
    expect(src).toMatch(/focusRefreshDue\(last, Date\.now\(\)\)\) revalidate\(\)/);
  });
});

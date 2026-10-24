import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { FOCUS_REFRESH_MS, focusRefreshDue } from '@/lib/focus-refresh';

// The browser till link re-read everything on every focus and visibilitychange:
// nine requests a window switch, often twice (2026-10-23).

describe('re-reading when the till comes back to the front', () => {
  it('waits half a minute after the last read', () => {
    expect(FOCUS_REFRESH_MS).toBe(30_000);
    expect(focusRefreshDue(1_000, 1_000)).toBe(false);
    expect(focusRefreshDue(1_000, 30_999)).toBe(false);
    expect(focusRefreshDue(1_000, 31_000)).toBe(true);
  });

  it('gates both focus and visibilitychange on the till page', () => {
    const src = readFileSync('app/seller/page.tsx', 'utf8');
    expect(src).toMatch(/const onFocus = \(\) => \{ if \(focusRefreshDue\(last, Date\.now\(\)\)\) sync\(\); \}/);
    expect(src).toMatch(/visibilityState === 'visible'\) onFocus\(\)/);
    expect(src).not.toMatch(/visibilityState === 'visible'\) refreshAll\(/);
    // The signed-in browser's own focus sync, too.
    expect(src).toMatch(/if \(!focusRefreshDue\(last, Date\.now\(\)\)\) return;\n\s+last = Date\.now\(\);\n\s+const ticket = beginOrdersRead\(\);/);
  });

  it('gates coming back to the admin page and its Kassa tab', () => {
    const src = readFileSync('app/admin/page.tsx', 'utf8');
    expect(src).not.toMatch(/visibilityState === 'visible'\) refreshAllRef\.current\(\)/);
    expect(src).toMatch(/!focusRefreshDue\(last, Date\.now\(\)\)\) return;\n\s+last = Date\.now\(\);\n\s+refreshAllRef\.current\(\);/);
    expect(src).not.toMatch(/visibilityState === 'visible'\) void reload\(\)/);
    expect(src).toMatch(/visibilityState === 'visible' && focusRefreshDue\(last, Date\.now\(\)\)\) void reload\(\)/);
  });

  it('gates both on the link page', () => {
    const src = readFileSync('app/s/[slug]/[token]/page.tsx', 'utf8');
    expect(src).toMatch(/visibilityState === 'visible'\) onFocus\(\)/);
    expect(src).not.toMatch(/addEventListener\('focus', revalidate\)/);
  });
});

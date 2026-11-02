import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyBrand, BRAND_BOOT_SCRIPT, rememberLogo, rememberedLogo } from '@/lib/branding';

// A reload painted teal and a cup for a second before the black brand and the
// logo came back from the database. The page now starts in the last ones seen.

function fakeBrowser() {
  const store = new Map<string, string>();
  const root = { dataset: {} as Record<string, string> };
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  });
  vi.stubGlobal('document', { documentElement: root });
  return root;
}

describe('remembered brand and logo', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });

  it('a reload starts in the last brand, not teal', () => {
    fakeBrowser();
    applyBrand('black');
    const reloaded = { dataset: {} as Record<string, string> };
    vi.stubGlobal('document', { documentElement: reloaded });
    new Function(BRAND_BOOT_SCRIPT)();
    expect(reloaded.dataset.brand).toBe('black');
  });

  it('first visit: nothing remembered, the boot script leaves the default', () => {
    const root = fakeBrowser();
    new Function(BRAND_BOOT_SCRIPT)();
    expect(root.dataset.brand).toBeUndefined();
  });

  it('logo: unknown until seen, then the url, and "no logo" is remembered too', () => {
    fakeBrowser();
    expect(rememberedLogo()).toBeUndefined();
    rememberLogo('https://x/logo.png');
    expect(rememberedLogo()).toBe('https://x/logo.png');
    rememberLogo(null);
    expect(rememberedLogo()).toBeNull();
  });
});

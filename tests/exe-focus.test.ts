// Latte Art, 2026-10-09: in the exe the payment sheet's Kart box lit up under
// the mouse but would not take the cursor; only Nağd, focused from code, could
// be typed in. A click that does not take is now finished from code, and every
// alert and confirm gives the window its focus back.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

class FakeElement {
  disabled = false;
  isConnected = true;
  closest() { return this; }
  focus() { doc.activeElement = this; }
}

const doc: { activeElement: unknown; listeners: Record<string, (e: unknown) => void>; addEventListener: (t: string, f: (e: unknown) => void) => void } = {
  activeElement: null,
  listeners: {},
  addEventListener(type, f) { this.listeners[type] = f; },
};

function exe() {
  const focusWindow = vi.fn(async () => {});
  const shown: string[] = [];
  vi.stubGlobal('Element', FakeElement);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', {
    posNative: { isDesktop: true, focusWindow },
    alert: (m: string) => { shown.push(m); },
    confirm: () => true,
  });
  return { focusWindow, shown };
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.useRealTimers(); doc.activeElement = null; });

describe('a box in the exe', () => {
  it('takes the cursor when the click alone did not give it', async () => {
    vi.useFakeTimers();
    const { focusWindow } = exe();
    (await import('@/lib/exe-focus')).installExeFocusFix();

    const kart = new FakeElement();
    doc.listeners.pointerup({ target: kart });
    vi.runAllTimers();

    expect(doc.activeElement).toBe(kart);
    expect(focusWindow).toHaveBeenCalled();
  });

  it('leaves a click that worked alone', async () => {
    vi.useFakeTimers();
    const { focusWindow } = exe();
    (await import('@/lib/exe-focus')).installExeFocusFix();

    const nagd = new FakeElement();
    doc.activeElement = nagd;
    doc.listeners.pointerup({ target: nagd });
    vi.runAllTimers();
    expect(focusWindow).not.toHaveBeenCalled();
  });

  it('gets the window back after an alert or a confirm', async () => {
    const { focusWindow, shown } = exe();
    (await import('@/lib/exe-focus')).installExeFocusFix();

    window.alert('Sifarişin məhsulları hələ yüklənməyib.');
    expect(shown).toEqual(['Sifarişin məhsulları hələ yüklənməyib.']);
    expect(window.confirm('Davam edilsin?')).toBe(true);
    expect(focusWindow).toHaveBeenCalledTimes(2);
  });

  it('is switched on by the seller page and answered by the exe', () => {
    expect(readFileSync('app/seller/page.tsx', 'utf8')).toMatch(/installExeFocusFix\(\)/);
    expect(readFileSync('electron/preload.ts', 'utf8')).toMatch(/focusWindow: .*'window:focus'/);
    const main = readFileSync('electron/main.ts', 'utf8');
    expect(main).toMatch(/ipcMain\.handle\('window:focus'/);
    // The window back in focus brings its page with it.
    expect(main).toMatch(/win\.on\('focus', \(\) => win\.webContents\.focus\(\)\)/);
  });
});

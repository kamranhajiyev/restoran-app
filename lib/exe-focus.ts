// A box in the exe that will not take a click.
//
// Latte Art, 2026-10-09: in the exe the payment sheet opened with Nağd ready to
// type in (autoFocus), but a click on Kart did nothing — the box lit up under
// the mouse and never took the cursor. Closing and reopening the sheet fixed it.
// Electron on Windows can stop moving focus on a click (after a native alert or
// confirm above all) while focusing from code still works. So in the exe: a
// click on a box that did not take the cursor is given it from code, and every
// alert and confirm hands the window its focus back.

import type {} from './desktopPrint';

const TYPED = 'input, textarea, select';

function refocusWindow(): void {
  void window.posNative?.focusWindow?.().catch(() => {});
}

/** The box a click landed on, if it is one that should take the cursor. */
function typedBox(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const box = target.closest(TYPED) as HTMLElement | null;
  if (!box || (box as HTMLInputElement).disabled) return null;
  return box;
}

let installed = false;

/** Once per page, and only inside the exe. */
export function installExeFocusFix(): void {
  if (installed || typeof window === 'undefined' || window.posNative?.isDesktop !== true) return;
  installed = true;

  document.addEventListener('pointerup', e => {
    const box = typedBox(e.target);
    if (!box) return;
    // After the click has had its chance to move the cursor.
    setTimeout(() => {
      if (document.activeElement === box || !box.isConnected) return;
      refocusWindow();
      box.focus();
    }, 0);
  }, true);

  const alertOf = window.alert.bind(window);
  const confirmOf = window.confirm.bind(window);
  window.alert = (message?: unknown) => { alertOf(message as string); refocusWindow(); };
  window.confirm = (message?: string) => { const yes = confirmOf(message); refocusWindow(); return yes; };
}

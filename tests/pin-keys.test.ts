// 2026-10-25, Natiq: a PIN should go in from a laptop keyboard. The lock screen
// took digits already; the manager's approval box took only clicks.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pinKey } from '@/lib/pin-keys';

describe('PIN from a keyboard', () => {
  it('reads the digit row and the number pad, with Num Lock on or off', () => {
    expect(pinKey({ key: '7', code: 'Digit7' })).toEqual({ digit: '7' });
    expect(pinKey({ key: '7', code: 'Numpad7' })).toEqual({ digit: '7' });
    expect(pinKey({ key: 'Home', code: 'Numpad7' })).toEqual({ digit: '7' });
  });

  it('erases with Backspace or Delete, closes with Esc, ignores the rest', () => {
    expect(pinKey({ key: 'Backspace', code: 'Backspace' })).toBe('back');
    expect(pinKey({ key: 'Delete', code: 'Delete' })).toBe('back');
    expect(pinKey({ key: 'Escape', code: 'Escape' })).toBe('cancel');
    expect(pinKey({ key: 'a', code: 'KeyA' })).toBeNull();
    expect(pinKey({ key: 'Enter', code: 'Enter' })).toBeNull();
  });

  it('is read by both PIN pads: the lock screen and the manager approval box', () => {
    for (const file of ['app/seller/page.tsx', 'components/seller/ApprovalPad.tsx']) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).toMatch(/pinKey\(e\)/);
      expect(src, file).toMatch(/addEventListener\('keydown'/);
    }
  });
});

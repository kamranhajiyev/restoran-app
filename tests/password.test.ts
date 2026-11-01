// 2026-11-01: the password rules every admin form uses (lib/password.ts) had
// no test. A weak owner password is the key to a restaurant's money.

import { describe, expect, it } from 'vitest';
import { generatePassword, passwordStrength, validatePassword } from '@/lib/password';

describe('a password', () => {
  it('needs 8 characters, a letter and a digit', () => {
    expect(validatePassword('abc123')).toMatch(/8 simvol/);
    expect(validatePassword('12345678')).toMatch(/hərf/);
    expect(validatePassword('abcdefgh')).toMatch(/rəqəm/);
    expect(validatePassword('abcdefg1')).toBeNull();
  });

  it('counts Azerbaijani letters as letters', () => {
    expect(validatePassword('şəkər1234')).toBeNull();
  });

  it('may not be the username', () => {
    expect(validatePassword('Kamran2026', ' kamran2026 ')).toMatch(/istifadəçi adı/);
    expect(validatePassword('Kamran2026', 'kamran')).toBeNull();
  });

  it('reads weak to strong', () => {
    expect(passwordStrength('abc')).toBe(0);
    expect(passwordStrength('abcdefg1')).toBe(1);
    expect(passwordStrength('Abcdefg1')).toBe(2);
    expect(passwordStrength('Abcdefgh12!x')).toBe(3);
  });

  it('is made to pass its own rules, and never twice the same', () => {
    const made = Array.from({ length: 50 }, generatePassword);
    for (const p of made) expect(validatePassword(p), p).toBeNull();
    expect(new Set(made).size).toBe(50);
  });
});

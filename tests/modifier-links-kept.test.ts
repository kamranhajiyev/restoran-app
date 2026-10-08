// Code review, 2026-10-08: when the modifier sets failed to load in admin, the
// list was [], and saving any dish edit filtered its sets against that empty
// list — the dish lost every set, with nothing on screen saying so. The same
// when only the dish's links failed to load (fetchMenu leaves them undefined).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const admin = readFileSync('app/admin/page.tsx', 'utf8');

describe('a dish edit in admin', () => {
  it('saves its modifier sets only when they really loaded', () => {
    expect(admin).toMatch(/fetchModifierGroupsOrNull\(\)\.then\(g => \{ if \(g\) \{ setModifierGroups\(g\); setModifiersLoaded\(true\); \} \}\)/);
    expect(admin).not.toMatch(/fetchModifierGroups\(\)\.then\(setModifierGroups\)/);
    expect(admin).toMatch(/modifierGroupIds: modifiersLoaded && form\.modifiersKnown \? form\.modifierGroupIds : undefined,/);
    expect(admin).toMatch(/modifiersKnown: item\.modifierGroupIds !== undefined,/);
  });

  it('does not filter a dish\'s sets against a list that may be empty', () => {
    expect(admin).not.toMatch(/form\.modifierGroupIds\.filter\(id => modifierGroups\.some/);
  });

  it('hides the set picker when it would show a wrong answer', () => {
    expect(admin).toMatch(/\{modifiersLoaded && form\.modifiersKnown && modifierGroups\.length > 0 && \(/);
  });
});

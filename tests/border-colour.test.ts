// A border with no colour of its own (`border-b`, `border-t`) came out black
// across the order list: Tailwind 4 draws it in the text colour, the pages were
// written for the old light grey. One base rule puts the grey back everywhere.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('plain borders', () => {
  it('default to light grey, not the text colour', () => {
    const css = readFileSync('app/globals.css', 'utf8');
    expect(css).toMatch(/@layer base\s*{[^}]*border-color:\s*var\(--color-stone-200/);
  });
});

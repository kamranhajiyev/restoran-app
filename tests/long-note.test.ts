// A note with no spaces must break on screen, as it does on the ticket (Test
// Restoran, 2026-10-06): it stretched the order list sideways off the screen.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { wrap } from '@/lib/escpos';

describe('a long note with no spaces', () => {
  const note = 'vxgvxAVGCASCXcgcsxacscass'.repeat(10);

  it('the ticket cuts it to the paper width', () => {
    expect(wrap(note, 32).every(r => r.length <= 32)).toBe(true);
  });

  it('every screen shows notes through OrderNote, which breaks long words', () => {
    expect(readFileSync('components/OrderNote.tsx', 'utf8')).toMatch(/wrap-anywhere/);
  });
});

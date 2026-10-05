// An online order's note on the kitchen ticket.
//
// Test Restoran, 2026-10-05: "Tel: … · Ünvan: … · Dolmaları sarımsaqsız…"
// printed as one line, and everything past the paper edge — the guest's own
// words — was cut off.

import { describe, expect, it } from 'vitest';
import { WIDTH, noteRows } from '@/lib/escpos';

const note = 'Tel: 0709771070 · Ünvan: Dəyirmanın kruqu · Dolmaları sarımsaqsız göndərərsiz zəhmət olmazsa';

describe('noteRows', () => {
  it('prints phone, then address, then the guest note under Qeyd', () => {
    const rows = noteRows(note);
    expect(rows[0]).toBe('Tel: 0709771070');
    expect(rows[1]).toBe('Ünvan: Dəyirmanın kruqu');
    expect(rows[2].startsWith('Qeyd: Dolmaları')).toBe(true);
  });

  it('keeps every word and no row is wider than the paper', () => {
    const rows = noteRows(note);
    expect(rows.every(r => r.length <= WIDTH)).toBe(true);
    expect(rows.join(' ')).toContain('zəhmət olmazsa');
  });

  it('wraps a long address instead of cutting it', () => {
    const rows = noteRows('Tel: 050 · Ünvan: Nərimanov rayonu, Təbriz küçəsi 44, blok 3, mənzil 27, girişdən sağda');
    expect(rows.join(' ')).toContain('girişdən sağda');
    expect(rows.every(r => r.length <= WIDTH)).toBe(true);
  });

  it('leaves a waiter note as Qeyd', () => {
    expect(noteRows('az duzlu')).toEqual(['Qeyd: az duzlu']);
  });
});

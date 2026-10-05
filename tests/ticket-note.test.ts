// An online order's note on the kitchen ticket.
//
// Test Restoran, 2026-10-05: "Tel: … · Ünvan: … · Dolmaları sarımsaqsız…"
// printed as one line, and everything past the paper edge — the guest's own
// words — was cut off.

import { describe, expect, it } from 'vitest';
import { ESC, WIDTH, buildStationTicket, noteRows, sizedNoteRows } from '@/lib/escpos';

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

describe('Qeyd in big type', () => {
  it('prints every Qeyd row big, and phone and address small', () => {
    const rows = sizedNoteRows(note, 30);
    expect(rows.filter(r => !r.big).map(r => r.text)).toEqual(['Tel: 0709771070', 'Ünvan: Dəyirmanın kruqu']);
    const qeyd = rows.filter(r => r.big);
    expect(qeyd.length).toBeGreaterThan(1);
    expect(qeyd.map(r => r.text).join(' ')).toContain('zəhmət olmazsa');
  });

  it('the character ticket switches to big type for Qeyd', () => {
    const bytes = buildStationTicket({
      kind: 'new', station: 'Bar', orderNumber: 1, table: 1, waiter: null,
      at: '2026-10-05T10:00:00Z', items: [{ name: 'Fanta', qty: 1 }], note: 'az buzlu',
    });
    const text = Array.from(bytes, b => String.fromCharCode(b)).join('');
    expect(text).toContain(`${ESC.BIG}Qeyd: az buzlu\n${ESC.NORMAL}`);
  });
});

// 2026-11-02: every part of a set printed with the set's whole name after it,
// "Fri · yarim (eco lahmacun set)", and a set named after its parts ran to three
// lines a dish. A set now prints once, upper-case, with its parts under it.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildStationTicket, partRows, ticketRows, type TicketItem } from '@/lib/escpos';

const set = (name: string, qty: number, set: string, setQty: number, setKey: string, modifiers?: string): TicketItem =>
  ({ name, qty, set, setQty, setKey, modifiers });

const items: TicketItem[] = [
  { name: 'Plov', qty: 1 },
  set('Lahmacun Sade', 2, 'eco lahmacun set', 2, 'a'),
  set('Şaurma toyuq', 1, 'eco şaurma set', 1, 'b', 'Şərh: soğansız'),
  set('Fri · yarim', 2, 'eco lahmacun set', 2, 'a'),
  set('Fri · yarim', 1, 'eco şaurma set', 1, 'b', 'Şərh: soğansız'),
  { name: 'Çoban salatı', qty: 2 },
];

describe('a set on a kitchen ticket', () => {
  it('prints once with its parts under it, a dotted line between sets, then the dishes', () => {
    expect(ticketRows(items)).toEqual([
      { kind: 'set', qty: 2, name: 'ECO LAHMACUN SET' },
      { kind: 'part', qty: 2, name: 'Fri · yarim' },
      { kind: 'part', qty: 2, name: 'Lahmacun Sade' },
      { kind: 'rule', heavy: false },
      { kind: 'set', qty: 1, name: 'ECO ŞAURMA SET' },
      { kind: 'part', qty: 1, name: 'Fri · yarim' },
      { kind: 'part', qty: 1, name: 'Şaurma toyuq' },
      { kind: 'note', text: 'ŞƏRH: SOĞANSIZ' },
      { kind: 'rule', heavy: true },
      { kind: 'dish', qty: 2, name: 'Çoban salatı', modifiers: undefined },
      { kind: 'dish', qty: 1, name: 'Plov', modifiers: undefined },
    ]);
  });

  it('keeps two lines of one set apart, and a ticket of dishes only as it was', () => {
    const two = ticketRows([set('Ayran', 1, 'Set 1', 1, 'x'), set('Ayran', 1, 'Set 1', 1, 'y')]);
    expect(two.filter(r => r.kind === 'set')).toHaveLength(2);
    expect(ticketRows([{ name: 'Plov', qty: 1 }])).toEqual([{ kind: 'dish', qty: 1, name: 'Plov', modifiers: undefined }]);
  });

  it('indents a part and wraps it under its own name', () => {
    expect(partRows(2, 'Fri · yarim')[0]).toBe('  · 2x Fri · yarim');
    const long = partRows(1, 'Lahmacun with a very long name indeed here', 20);
    expect(long.every(r => r.length <= 20)).toBe(true);
    expect(long[1].startsWith(' '.repeat('  · 1x '.length))).toBe(true);
  });

  it('is the layout of both printer paths, and the till and database send the set', () => {
    const text = new TextDecoder('latin1').decode(buildStationTicket({
      kind: 'new', station: 'Mətbəx', orderNumber: 1, table: 2, waiter: null, at: '2026-11-02T10:00:00Z', items,
    }));
    expect(text).toContain('ECO LAHMACUN SET');
    expect(text).not.toContain('(eco lahmacun set)');
    expect(readFileSync('lib/station-ticket.ts', 'utf8')).toMatch(/ticketRows\(p\.items\)/);
    expect(readFileSync('lib/desktopPrint.ts', 'utf8')).toMatch(/set: line\.inSet\.name, setQty: line\.inSet\.qty, setKey: line\.inSet\.key/);
    const sql = readFileSync('supabase/migrations/20261109_set_block_tickets.sql', 'utf8');
    expect(sql.match(/'set', pl\.set_name, 'setQty', pl\.set_qty, 'setKey'/g)).toHaveLength(7);
    expect(sql).not.toMatch(/' \(' \|\| p_name \|\| '\)'/);
  });
});

// Natiq, 2026-11-22: a set's Şərh printed between its name and its parts, so it
// read as the note of the part under it; and a cook should not miss a Şərh.
describe('a Şərh on a kitchen ticket', () => {
  it('a set\'s note comes after all its parts', () => {
    const rows = ticketRows([set('Fanta · 0.5 L', 1, 'set 2', 1, 's', 'Şərh: pomidor, xiyar olmasın')]);
    expect(rows).toEqual([
      { kind: 'set', qty: 1, name: 'SET 2' },
      { kind: 'part', qty: 1, name: 'Fanta · 0.5 L' },
      { kind: 'note', text: 'ŞƏRH: POMİDOR, XİYAR OLMASIN' },
    ]);
  });
  it('is in capitals on a dish too; the options stay as they are', () => {
    expect(ticketRows([{ name: 'Latte', qty: 1, modifiers: 'Böyük · Şərh: şəkərsiz' }]))
      .toEqual([{ kind: 'dish', qty: 1, name: 'Latte', modifiers: 'Böyük · ŞƏRH: ŞƏKƏRSİZ' }]);
    expect(ticketRows([{ name: 'Latte', qty: 1, modifiers: 'Böyük' }]))
      .toEqual([{ kind: 'dish', qty: 1, name: 'Latte', modifiers: 'Böyük' }]);
  });
  it('both printer paths print the note row', () => {
    for (const f of ['lib/escpos.ts', 'lib/station-ticket.ts']) {
      expect(readFileSync(f, 'utf8')).toMatch(/r\.kind === 'note'/);
    }
    const text = new TextDecoder('latin1').decode(buildStationTicket({
      kind: 'new', station: 'Mətbəx', orderNumber: 1, table: 2, waiter: null, at: '2026-11-02T10:00:00Z',
      items: [set('Fanta', 1, 'set 2', 1, 's', 'Şərh: xiyarsız')],
    }));
    expect(text.indexOf('Fanta')).toBeLessThan(text.indexOf('YARSIZ'));
  });
});

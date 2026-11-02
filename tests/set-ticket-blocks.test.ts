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
      { kind: 'set', qty: 2, name: 'ECO LAHMACUN SET', modifiers: undefined },
      { kind: 'part', qty: 2, name: 'Fri · yarim' },
      { kind: 'part', qty: 2, name: 'Lahmacun Sade' },
      { kind: 'rule', heavy: false },
      { kind: 'set', qty: 1, name: 'ECO ŞAURMA SET', modifiers: 'Şərh: soğansız' },
      { kind: 'part', qty: 1, name: 'Fri · yarim' },
      { kind: 'part', qty: 1, name: 'Şaurma toyuq' },
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

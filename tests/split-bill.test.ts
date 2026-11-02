// "Hesabı böl": one table's bill becomes one per guest. The bills must add up
// to the bill they came from, and a dish sold by weight is never cut.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applySplit, canSplit, cleanSplitParts, splitParts, splitPieces, splitRequest } from '@/lib/split-bill';
import type { Order } from '@/types';
import type { OrderItem } from '@/types';

const line = (name: string, price: number, quantity: number) =>
  ({ menuItem: { id: name, name, price }, quantity }) as OrderItem;

const items = [line('Capucino', 3, 4), line('Croissant', 4, 2), line('Ət', 20, 0.35)];

describe('split bill', () => {
  it('cuts each dish into single pieces, but not one sold by weight', () => {
    const pieces = splitPieces(items);
    expect(pieces.map(p => p.quantity)).toEqual([1, 1, 1, 1, 1, 1, 0.35]);
    expect(pieces[6].line).toBe(2);
  });

  it('puts a guest\'s pieces of one dish back on one line', () => {
    const pieces = splitPieces(items);
    const parts = splitParts(pieces, [1, 2, 2, 1, 2, 1, 1], 2);
    expect(parts[1].items).toEqual([{ ...items[0], quantity: 2 }, { ...items[1], quantity: 1 }]);
    expect(parts[1].total).toBe(10);
  });

  it('adds up to the bill it came from', () => {
    const pieces = splitPieces(items);
    const parts = splitParts(pieces, [1, 2, 3, 1, 2, 3, 1], 3);
    const sum = parts.reduce((s, p) => s + p.dishes, 0);
    expect(Math.round(sum * 100) / 100).toBe(27);
  });

  it('gives each bill its own service charge', () => {
    const parts = splitParts(splitPieces([line('Çay', 10, 2)]), [1, 2], 2, 10);
    expect(parts.map(p => p.total)).toEqual([11, 11]);
  });

  it('needs two guests with something on their bill', () => {
    const pieces = splitPieces(items);
    expect(canSplit(splitParts(pieces, pieces.map(() => 1), 3))).toBe(false);
    expect(canSplit(splitParts(pieces, [1, 1, 1, 1, 1, 1, 3], 3))).toBe(true);
  });
});

describe('split request', () => {
  const withIds = [
    { ...line('Capucino', 3, 4), id: 'cap' },
    { ...line('Croissant', 4, 2), id: 'cro' },
  ] as OrderItem[];
  let n = 0;
  const id = () => `id${++n}`;

  it('leaves guest 1 on the original and names every moved line', () => {
    const pieces = splitPieces(withIds);
    const parts = splitParts(pieces, [1, 2, 2, 1, 3, 1], 3);
    const req = splitRequest(parts, id);
    expect(req).toHaveLength(2);
    expect(req[0].lines).toEqual([{ id: 'cap', quantity: 2, newId: expect.any(String) }]);
    expect(req[1].lines).toEqual([{ id: 'cro', quantity: 1, newId: expect.any(String) }]);
  });

  it('refuses a request that is not one', () => {
    expect(cleanSplitParts(null)).toBeNull();
    expect(cleanSplitParts([{ orderId: 'B', lines: [{ id: 'cap', quantity: 1.5, newId: 'x' }] }])).toBeNull();
    expect(cleanSplitParts([{ orderId: 'B', lines: [{ id: 'cap', quantity: 0, newId: 'x' }] }])).toBeNull();
    expect(cleanSplitParts([{ orderId: 'B', lines: [] }])).toBeNull();
  });

  it('adds up to the bill it came from once applied', () => {
    const order = { id: 'A', tableNumber: 2, items: withIds } as unknown as Order;
    const req = splitRequest(splitParts(splitPieces(withIds), [1, 2, 3, 1, 2, 1], 3), id);
    const done = applySplit(order, req)!;
    const sum = (o: Order) => o.items.reduce((s, oi) => s + oi.menuItem.price * oi.quantity, 0);
    expect(sum(done.original) + done.created.reduce((s, o) => s + sum(o), 0)).toBe(20);
    expect(done.created.every(o => o.tableNumber === 2)).toBe(true);
  });

  it('never empties the original bill', () => {
    const order = { id: 'A', items: withIds } as unknown as Order;
    expect(applySplit(order, [{ orderId: 'B', lines: [
      { id: 'cap', quantity: 4, newId: 'x' }, { id: 'cro', quantity: 2, newId: 'y' },
    ] }])).toBeNull();
  });

  // 2026-11-02: a guest whose dishes were all removed meanwhile got an empty
  // bill on the table. Their bill is skipped instead, here and in split_order().
  it('makes no bill for a guest with nothing still on the order', () => {
    const order = { id: 'A', items: withIds } as unknown as Order;
    const done = applySplit(order, [
      { orderId: 'B', lines: [{ id: 'cap', quantity: 1, newId: 'x' }] },
      { orderId: 'C', lines: [{ id: 'gone', quantity: 1, newId: 'y' }] },
    ])!;
    expect(done.created.map(o => o.id)).toEqual(['B']);
    const sql = readFileSync('supabase/migrations/20261108_split_no_empty_bill.sql', 'utf8');
    expect(sql).toMatch(/if not exists \(\s*select 1 from jsonb_to_recordset[\s\S]*?then continue; end if;/);
  });
});

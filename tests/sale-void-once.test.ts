// Sell 4, delete, restore, delete again: stock went 270 → 274 → 270 → 278, and
// up by 4 more every round (customer report, 2026-11-27). A delete gave back
// every 'sale' line the order ever had and forgot what earlier deletes already
// gave back. What the database really does is checked in tests-db/stock.test.ts.

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = 'supabase/migrations';

/** The reasons the newest apply_stock_on_payment adds up to know what a deleted sale gives back. */
function voidReads(): string[] {
  const fn = readdirSync(DIR).sort()
    .map(f => readFileSync(`${DIR}/${f}`, 'utf8'))
    .filter(s => s.includes('function public.apply_stock_on_payment')).at(-1)!;
  const voidBranch = fn.slice(fn.indexOf("NEW.status in ('ləğv edildi','silinib')"));
  const reads = [...voidBranch.matchAll(/from stock_movements where order_id = NEW\.id and reason (?:= '(\w+)'|in \(([^)]*)\))/g)];
  expect(reads.length).toBe(2); // the balance and the movement read the same thing
  const lists = reads.map(m => (m[1] ? [m[1]] : m[2].split(',').map(s => s.trim().replace(/'/g, ''))).sort());
  expect(lists[0]).toEqual(lists[1]);
  return lists[0];
}

/** Stock after selling `qty`, then deleting and restoring it `rounds` times, as the newest SQL does it. */
function afterRounds(start: number, qty: number, rounds: number): number {
  const reads = voidReads();
  const log: { reason: string; qty: number }[] = [];
  let stock = start;
  const sell = () => { log.push({ reason: 'sale', qty: -qty }); stock -= qty; };
  const del = () => {
    const held = log.filter(m => reads.includes(m.reason)).reduce((s, m) => s + m.qty, 0);
    if (held !== 0) { log.push({ reason: 'sale_void', qty: -held }); stock -= held; }
  };
  sell();
  for (let i = 0; i < rounds; i++) { del(); if (i < rounds - 1) sell(); }
  return stock;
}

describe('deleting a restored sale', () => {
  it('gives back exactly what it took, however many times it is restored', () => {
    expect(afterRounds(274, 4, 1)).toBe(274);
    expect(afterRounds(274, 4, 2)).toBe(274);
    expect(afterRounds(274, 4, 3)).toBe(274);
    expect(afterRounds(274, 10, 5)).toBe(274);
  });
});

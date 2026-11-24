// LƏĞV is for food that may still be cooking: deleting a paid order from admin
// printed one, even for an order days old (Natiq, 2026-11-23). What the database
// really does is checked in tests-db/printing.test.ts.

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = 'supabase/migrations';
const STATUSES = ['gözləyir', 'hazırlanır', 'hazırdır', 'ödənilib', 'ləğv edildi', 'silinib'];

/** The WHEN of the newest orders_enqueue_cancel, as a JS condition. */
function prints(): (from: string, to: string) => boolean {
  const last = readdirSync(DIR).sort()
    .map(f => readFileSync(`${DIR}/${f}`, 'utf8'))
    .filter(s => s.includes('create trigger orders_enqueue_cancel')).at(-1)!;
  const when = last.match(/create trigger orders_enqueue_cancel[\s\S]*?when \(([\s\S]*?)\)\s*execute function/)![1];
  const js = when
    .replace(/(new|old)\.status not in \(([^)]*)\)/g, '![$2].includes($1)')
    .replace(/(new|old)\.status in \(([^)]*)\)/g, '[$2].includes($1)')
    .replace(/(new|old)\.status = /g, '$1 === ')
    .replace(/\band\b/g, '&&').replace(/\bor\b/g, '||').replace(/\bnot\b/g, '!')
    .replace(/\bnew\b/g, 'to').replace(/\bold\b/g, 'from');
  return new Function('from', 'to', `return ${js}`) as (from: string, to: string) => boolean;
}

describe('the LƏĞV slip of a whole order', () => {
  const p = prints();

  it('is not printed when an already closed order is deleted', () => {
    for (const from of ['ödənilib', 'ləğv edildi', 'silinib']) expect(p(from, 'silinib'), from).toBe(false);
  });

  it('is printed when an open order is deleted or closed without payment', () => {
    for (const from of ['gözləyir', 'hazırlanır', 'hazırdır']) {
      expect(p(from, 'silinib'), from).toBe(true);
      expect(p(from, 'ləğv edildi'), from).toBe(true);
    }
  });

  it('is printed when a courier brings an order back, as before', () => {
    expect(p('ödənilib', 'ləğv edildi')).toBe(true);
  });

  it('is never printed for any other change', () => {
    for (const from of STATUSES) for (const to of STATUSES) {
      if (to !== 'silinib' && to !== 'ləğv edildi') expect(p(from, to), `${from} > ${to}`).toBe(false);
    }
  });
});

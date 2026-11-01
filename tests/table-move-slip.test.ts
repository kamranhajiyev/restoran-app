// 2026-10-31: the "MASA DƏYİŞDİ" slip printed at every station on every table
// move, and the owner had no way to stop it. Now it is a switch on the
// companies row, on by default, checked by the move trigger itself.

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

let row: { data: unknown; error: unknown } = { data: null, error: null };
let rpcError: unknown = null;

vi.mock('@/lib/supabase', () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.single = () => Promise.resolve(row);
  return { supabase: { from: () => chain, rpc: () => Promise.resolve({ error: rpcError }) } };
});

import { fetchPrintTableMove, setCompanyContext, setPrintTableMove } from '@/lib/store';

describe('the admin switch', () => {
  it('shows what the database says, and nothing when it could not ask', async () => {
    setCompanyContext('c1');
    row = { data: { print_table_move: false }, error: null };
    expect(await fetchPrintTableMove()).toBe(false);
    row = { data: { print_table_move: true }, error: null };
    expect(await fetchPrintTableMove()).toBe(true);
    // A failed read must not show "on" for a restaurant that turned it off.
    row = { data: null, error: { message: 'network' } };
    expect(await fetchPrintTableMove()).toBeNull();
  });

  it('reports a failed save', async () => {
    rpcError = { message: 'not_owner' };
    expect(await setPrintTableMove(false)).toBe(false);
    rpcError = null;
    expect(await setPrintTableMove(false)).toBe(true);
  });
});

const DIR = 'supabase/migrations';
const files = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
const read = (f: string) => readFileSync(`${DIR}/${f}`, 'utf8');

// The live trigger body is the one in the last migration that defines it.
function latest(fn: string): string {
  const f = [...files].reverse().find(f => read(f).includes(`create or replace function public.${fn}(`));
  if (!f) throw new Error(`${fn} is never defined`);
  const sql = read(f);
  const start = sql.indexOf(`create or replace function public.${fn}(`);
  return sql.slice(start, sql.indexOf('$function$;', start));
}

describe('the table-move slip switch', () => {
  const sql = read('20261103_table_move_slip.sql');

  it('is on by default, so restaurants keep the slip until they turn it off', () => {
    expect(sql).toMatch(/add column if not exists print_table_move boolean not null default true/);
  });

  it('is checked by the move trigger before any slip is queued', () => {
    const body = latest('enqueue_print_jobs_table_move');
    const check = body.indexOf('print_table_move');
    expect(check, 'the trigger must read print_table_move').toBeGreaterThan(-1);
    expect(check).toBeLessThan(body.indexOf('insert into public.print_jobs'));
    // A missing row or a null still prints, like the default.
    expect(body).toMatch(/coalesce\(\(select c\.print_table_move [^)]*\), true\)/);
  });

  it('is written only by the restaurant owner, never the public key', () => {
    expect(sql).toMatch(/role = 'owner'/);
    expect(sql).toMatch(/revoke execute on function public\.set_print_table_move\(boolean\) from public, anon/);
    expect(sql).not.toMatch(/to [^;]*\banon\b/);
  });
});

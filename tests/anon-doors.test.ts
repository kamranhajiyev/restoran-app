// Code review, 2026-10-08: the public anon key kept turning up with access it
// should not have — order counters, the till token, courier functions, the
// photo bucket — each opened back when tills talked to the database directly.
// 20261009_close_anon_doors.sql closed all of it at once. This keeps it closed:
// a migration after it that gives anon anything must say why, on a `-- anon:`
// line, and what anon keeps is one list, here and in the database check.

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// What the QR menu needs, and the two helpers the companies read rule calls.
const ALLOWED_FUNCTIONS = [
  'get_public_menu_items', 'get_public_categories', 'get_public_table',
  'get_my_company_id', 'is_superadmin',
];

const DIR = 'supabase/migrations';
const CLOSE = '20261009_close_anon_doors.sql';
const files = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
const close = readFileSync(`${DIR}/${CLOSE}`, 'utf8');
const check = readFileSync('supabase/checks/anon_reach.sql', 'utf8');

/** Statements in `sql` that open something to anon, without a `-- anon:` reason just above. */
function unexplained(sql: string): string[] {
  const lines = sql.split('\n');
  const out: string[] = [];
  lines.forEach((line, i) => {
    const code = line.replace(/--.*$/, '');
    const opens =
      /\bgrant\b[\s\S]*\bto\b[^;]*\b(anon|public)\b/i.test(code)
      || /\bcreate policy\b/i.test(code) && /\bto\s+(anon|public)\b/i.test(lines.slice(i, i + 3).join(' '));
    if (!opens) return;
    const reason = lines.slice(Math.max(0, i - 3), i).some(l => /--\s*anon:/i.test(l));
    if (!reason) out.push(line.trim());
  });
  return out;
}

describe('the public key', () => {
  it('is closed by the last migration of its day, after everything that opened it', () => {
    expect(files.at(-1) === CLOSE || files.indexOf(CLOSE) > files.findIndex(f => f.startsWith('20261008'))).toBe(true);
    expect(files.filter(f => f.startsWith('20261008')).every(f => f < CLOSE)).toBe(true);
  });

  it('keeps only the functions on the allowed list', () => {
    const granted = [...close.matchAll(/grant execute on function public\.(\w+)\([^)]*\) to anon;/g)].map(m => m[1]);
    expect(granted.sort()).toEqual([...ALLOWED_FUNCTIONS].sort());
    for (const name of ALLOWED_FUNCTIONS) expect(check).toContain(`('${name}')`);
    expect(close).toMatch(/revoke execute on function %s from public, anon/);
    expect(close).toMatch(/revoke all on %s from anon/);
  });

  it('keeps signed-in users and the server working', () => {
    expect(close).toMatch(/if has_function_privilege\('authenticated', f\.sig, 'execute'\) then\s+execute format\('grant execute on function %s to authenticated'/);
    expect(close).toMatch(/if has_function_privilege\('service_role', f\.sig, 'execute'\) then\s+execute format\('grant execute on function %s to service_role'/);
  });

  it('is opened again only with a reason', () => {
    const later = files.filter(f => f > CLOSE);
    const found = later.flatMap(f => unexplained(readFileSync(`${DIR}/${f}`, 'utf8')).map(s => `${f}: ${s}`));
    expect(found).toEqual([]);
  });

  it('catches a grant without a reason', () => {
    expect(unexplained('grant select on public.orders to anon;')).toHaveLength(1);
    expect(unexplained('create policy x on storage.objects\n  for insert to public\n  with check (true);')).toHaveLength(1);
    expect(unexplained('-- anon: the QR menu reads it\ngrant select on public.x to anon;')).toEqual([]);
    expect(unexplained('grant execute on function f() to authenticated;')).toEqual([]);
  });
});

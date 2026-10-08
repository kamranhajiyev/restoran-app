// 2026-10-08: four things were open to the public anon key because each
// feature had to remember to close what it made. New objects are now closed
// by default (20261008_closed_by_default.sql); this test keeps it that way and
// catches a new table that skips row level security or a migration that opens
// something to anon.

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = 'supabase/migrations';
const files = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
const since = (date: string) => files.filter(f => f >= date).map(f => ({ f, sql: readFileSync(`${DIR}/${f}`, 'utf8').toLowerCase() }));

describe('the public key', () => {
  it('gets nothing new by default', () => {
    const sql = readFileSync(`${DIR}/20261008_closed_by_default.sql`, 'utf8');
    expect(sql).toMatch(/revoke all on tables from anon/);
    expect(sql).toMatch(/revoke execute on functions from anon/);
    expect(sql).toMatch(/revoke execute on functions from public/);
  });

  it('every new table has row level security', () => {
    for (const { f, sql } of since('20261008')) {
      for (const m of sql.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+)/g)) {
        expect(sql, `${f}: ${m[1]} needs row level security`).toMatch(
          new RegExp(`alter table (?:public\\.)?${m[1]} enable row level security`));
      }
    }
  });

  it('is never given anything back without a comment saying why', () => {
    for (const { f, sql } of since('20261008')) {
      for (const m of sql.matchAll(/^grant [^;]* to [^;]*\banon\b[^;]*;/gm)) {
        const before = sql.slice(0, m.index);
        expect(before.trimEnd().split('\n').pop(), `${f}: grant to anon needs a "-- anon:" reason`).toMatch(/^-- anon:/);
      }
    }
  });
});

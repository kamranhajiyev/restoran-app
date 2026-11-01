// scripts/check-money reads production, and production has no backups. Owner's
// rule, 2026-11-01: production is only ever read. readOnlySql lets through one
// plain statement, in a read-only transaction, and nothing else.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readOnlySql } from '@/lib/read-only-sql';

describe('readOnlySql', () => {
  it('wraps a plain read in a read-only transaction', () => {
    expect(readOnlySql("select id, created_at, updated_at, deleted_at from orders where status = 'ödənilib'"))
      .toBe("begin transaction read only; select id, created_at, updated_at, deleted_at from orders where status = 'ödənilib'; commit;");
  });

  it.each([
    "update orders set status = 'x'",
    'delete from orders',
    "insert into orders (id) values ('x')",
    'drop table orders',
    'truncate orders',
    'select 1; delete from orders',
    'select 1; commit',
    'with x as (delete from orders returning *) select * from x',
    "select set_config('x', 'y', false)",
    'Select * From orders For UPDATE',
    "select nextval('orders_seq')",
    'select pg_terminate_backend(1)',
    "select pg_read_file('/etc/passwd')",
  ])('refuses %s', q => {
    expect(() => readOnlySql(q)).toThrow(/refused/);
  });

  it('check-money sends every query through it, to production only', () => {
    const src = readFileSync('scripts/check-money.ts', 'utf8');
    expect(src).toMatch(/const body = readOnlySql\(query\)/);
    expect(src).toMatch(/body: JSON\.stringify\(\{ query: body \}\)/);
    expect(src.match(/fetch\(/g)).toHaveLength(1);
  });
});

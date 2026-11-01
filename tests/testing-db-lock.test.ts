// 2026-11-01: the database tests write real rows. .env.local also holds the
// production keys, commented out; if they were ever switched on, the tests must
// stop before touching production.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { notTestingReason } from '@/lib/testing-db';

describe('the database tests', () => {
  it('run on restoran testing', () => {
    expect(notTestingReason('https://bmqilobhdbipnpkyzomb.supabase.co')).toBeNull();
  });

  it('refuse production, other projects and a missing URL', () => {
    expect(notTestingReason('https://laxeqbztathmxfbkkthb.supabase.co')).toMatch(/PRODUCTION/);
    expect(notTestingReason('https://bmqilobhdbipnpkyzomb.supabase.co.evil.com')).not.toBeNull();
    expect(notTestingReason('https://other.supabase.co')).not.toBeNull();
    expect(notTestingReason(undefined)).not.toBeNull();
    expect(notTestingReason('not a url')).not.toBeNull();
  });

  it('check the lock before any client is made', () => {
    const setup = readFileSync('tests-db/setup.ts', 'utf8');
    expect(setup.indexOf('notTestingReason(')).toBeGreaterThan(-1);
    expect(setup.indexOf('notTestingReason(')).toBeLessThan(setup.indexOf('createClient('));
  });
});

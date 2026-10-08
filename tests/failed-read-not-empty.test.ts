// 2026-10-08: more failures that answered as "nothing". On a database error
// /api/public-staff answered 200 with no staff, and the exe saved that over its
// own list — nobody could sign in with a PIN. Users, login history and stations
// did the same on admin and the till, and reads had no time limit at all.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { withTimeout } from '@/lib/timeout';

const read = (p: string) => readFileSync(p, 'utf8');

describe('a route that failed', () => {
  it('answers with an error status, not an empty list', () => {
    for (const p of ['app/api/public-staff/route.ts', 'app/api/users/route.ts', 'app/api/login-events/route.ts']) {
      expect(read(p)).not.toMatch(/if \(error\) return Response\.json\((\[\]|\{ staff: \[\] \})\);/);
    }
  });
});

describe('screens keep what they show on a failed read', () => {
  it('admin users and login history', () => {
    const admin = read('app/admin/page.tsx');
    expect(admin).toMatch(/if \(!users\) return;/);
    expect(admin).not.toMatch(/fetchLoginEvents\(\)\.then\(ev => \{ setLoginEvents\(ev\)/);
  });

  it('the till stations', () => {
    expect(read('app/seller/page.tsx')).not.toMatch(/setStations\(d\.stations \?\? \[\]\)/);
  });
});

describe('every read', () => {
  it('gets a time limit unless it brings its own', () => {
    expect(withTimeout(undefined, 1000).signal).toBeInstanceOf(AbortSignal);
    const own = new AbortController().signal;
    expect(withTimeout({ signal: own }, 1000).signal).toBe(own);
    expect(read('lib/supabase.ts')).toMatch(/withTimeout\(init, READ_MS\)/);
    expect(read('lib/till-data.ts')).toMatch(/withTimeout\(.*READ_MS\)/);
  });
});

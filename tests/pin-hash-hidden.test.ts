// 2026-10-08: staff.pin_hash was readable by any signed-in user of the company;
// a four-digit PIN's hash is guessed offline in seconds, past the lockout.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('staff PINs', () => {
  it('are left out of what the browser may read', () => {
    const sql = readFileSync('supabase/migrations/20261008_hide_pin_hash.sql', 'utf8');
    expect(sql).toMatch(/revoke select on public\.staff from anon, authenticated/);
    expect(sql.slice(sql.indexOf('grant select'))).not.toMatch(/pin_hash/);
  });

  it('are never read by the app', () => {
    expect(readFileSync('lib/store.ts', 'utf8')).not.toMatch(/from\('staff'\)\s*\.select\('[^']*(pin_hash|\*)/);
  });
});

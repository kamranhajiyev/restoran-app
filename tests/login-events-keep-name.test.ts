// Test Restoran, 2026-10-14: Rasim, a kitchen employee, could not be deleted.
// His two logins in Girişlər were linked to his profile and the database
// refused to delete it. A login now keeps the name it was made under.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loginEventFromRow } from '@/lib/login-events';

const sql = readFileSync('supabase/migrations/20261023_login_events_keep_name.sql', 'utf8');

describe('deleting a person', () => {
  it('unlinks their logins instead of being refused', () => {
    expect(sql).toMatch(/alter column user_id drop not null/);
    expect(sql).toMatch(/references public\.profiles\(id\) on delete set null/);
  });

  it('copies the name onto every new login, in the database', () => {
    expect(sql).toMatch(/before insert on public\.login_events/);
    expect(sql).toMatch(/into new\.name, new\.username, new\.role/);
    expect(sql).toMatch(/revoke all on function public\.login_event_name\(\) from public, anon, authenticated;/);
  });

  it('still shows who logged in after they are gone', () => {
    const gone = { id: '1', ip: null, user_agent: null, created_at: '2026-07-17', name: 'Rasim', username: 'rasim', role: 'employee', profiles: null };
    expect(loginEventFromRow(gone)).toMatchObject({ name: 'Rasim', username: 'rasim', role: 'employee' });
  });

  it('reads the saved name from the server, and Girişlər uses one mapping', () => {
    expect(readFileSync('app/api/login-events/route.ts', 'utf8')).toMatch(/created_at, name, username, role, profiles\(/);
    expect(readFileSync('lib/store.ts', 'utf8')).toMatch(/data\.map\(loginEventFromRow\)/);
  });
});

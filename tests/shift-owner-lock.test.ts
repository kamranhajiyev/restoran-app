// Natiq, 2026-10-13: money that has reached Nağd, Bank or İnkassasiya must not
// change unless the owner changes it. Maliyyə reads that money from the shift
// (lib/finance), and the till has to write shifts, so any signed-in login could
// update a closed shift or drop an inkassasiya already written. No screen did
// it; the database did not refuse it. 20261021_shift_owner_lock.sql does.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20261021_shift_owner_lock.sql', 'utf8');
const store = readFileSync('lib/store.ts', 'utf8');

describe('a shift, for a login that is not the owner', () => {
  it('is guarded on every insert and update, by the database', () => {
    expect(sql).toMatch(/create trigger cash_shift_guard before insert or update on public\.cash_shifts\s+for each row/);
  });

  it('cannot be touched once it is closed', () => {
    expect(sql).toMatch(/if old\.closed_at is not null then\s+raise exception 'owner_only: the shift is closed'/);
  });

  it('keeps every movement already written: they are only added', () => {
    expect(sql).toMatch(/jsonb_array_length\(new\.movements\) < kept/);
    expect(sql).toMatch(/where n <= kept\), '\[\]'::jsonb\)\s+<> old\.movements/);
  });

  it('keeps what it opened with, and cannot be inserted already closed or with movements', () => {
    expect(sql).toMatch(/new\.opening_cash is distinct from old\.opening_cash/);
    expect(sql).toMatch(/new\.closed_at is not null[\s\S]*?new\.counted_cash is not null[\s\S]*?new\.movements <> '\[\]'::jsonb/);
  });

  it('the owner, the superadmin and the server are let through; "no owner company" is a no', () => {
    expect(sql).toMatch(/if auth\.uid\(\) is null\s+or coalesce\(new\.company_id = get_my_owner_company_id\(\), false\)\s+or is_superadmin\(\) then\s+return new;/);
  });
});

// The other half: the till must never need what the guard refuses, or sales stop.
describe('the till', () => {
  const body = (name: string) => {
    const at = store.indexOf(`export async function ${name}(`);
    return store.slice(at, store.indexOf('\nexport ', at + 1));
  };

  it('opens a shift empty', () => {
    expect(body('openShift')).toMatch(/\.insert\(\{ company_id: _companyId, opening_cash: openingCash, opened_by: openedBy \}\)/);
  });

  it('adds a movement by appending, never by writing the list back', () => {
    expect(body('addShiftMovement')).toMatch(/rpc\('append_shift_movement'/);
    expect(body('addShiftMovement')).not.toMatch(/from\('cash_shifts'\)/);
  });

  it('closes only a shift that is still open, and writes only the closing figures', () => {
    const close = body('closeShift');
    expect(close).toMatch(/\.is\('closed_at', null\)/);
    const written = close.match(/\.update\(\{([\s\S]*?)\}\)/)![1];
    expect([...written.matchAll(/(\w+):/g)].map(m => m[1]).sort())
      .toEqual(['card_sales', 'closed_at', 'closed_by', 'counted_card', 'counted_cash', 'expected_cash']);
  });

  it('touches shifts nowhere else in the store', () => {
    const writes = [...store.matchAll(/from\('cash_shifts'\)\s*\.(insert|update|upsert|delete)\(/g)];
    expect(writes).toHaveLength(2);
  });
});

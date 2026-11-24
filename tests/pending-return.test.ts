// Review, 2026-11-24: the internet drops while a return is being saved, the
// cashier leaves Qaytarma and starts again: a new id, so the customer could be
// paid twice. And its line in Kassa could be changed or deleted on its own.

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mustAskFirst, pendingOutcome, pendingWindow, readPendingReturn, writePendingReturn, type PendingReturn } from '@/lib/pending-return';
import { returnErrorText, returnRefused } from '@/lib/returns';

const read = (p: string) => readFileSync(p, 'utf8');
const p: PendingReturn = { id: 'r1', key: 'k', at: '2026-11-24T10:00:00.000Z', total: 5, pay: 'cash', receipt: '45', seller: 'Aysel' };

describe('a return whose answer never came', () => {
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    vi.stubGlobal('localStorage', { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is remembered through leaving and a reload, one restaurant apart from another', () => {
    writePendingReturn('c1', p);
    expect(readPendingReturn('c1')).toEqual(p);
    expect(readPendingReturn('c2')).toBeNull();
    writePendingReturn('c1', null);
    expect(readPendingReturn('c1')).toBeNull();
  });
  it('a broken or blocked store never stops the till', () => {
    store['restoran_pending_return:c1'] = '{nonsense';
    expect(readPendingReturn('c1')).toBeNull();
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(readPendingReturn('c1')).toBeNull();
    expect(() => writePendingReturn('c1', p)).not.toThrow();
  });
  it('pressed again without leaving is the same one; after leaving, or changed, it asks', () => {
    expect(mustAskFirst(null, null, 'k')).toBe(false);
    expect(mustAskFirst(p, { key: 'k', id: 'r1' }, 'k')).toBe(false);
    expect(mustAskFirst(p, null, 'k')).toBe(true);                      // left, or reloaded
    expect(mustAskFirst(p, { key: 'k', id: 'r1' }, 'other')).toBe(true); // the cart changed
  });
  it('saved, not saved, or not known: an unread list is never "not saved"', () => {
    expect(pendingOutcome(p, [{ id: 'r1', total: 4.9 }])).toEqual({ state: 'saved', total: 4.9 });
    expect(pendingOutcome(p, [{ id: 'other', total: 5 }])).toEqual({ state: 'not_saved' });
    expect(pendingOutcome(p, null)).toEqual({ state: 'unknown' });
  });
  it('looks a day each way, for a till with a wrong clock', () => {
    expect(pendingWindow(p, Date.parse('2026-11-24T10:05:00Z'))).toEqual({ from: '2026-11-23T10:00:00.000Z', to: '2026-11-25T10:05:00.000Z' });
  });
  it('only the server\'s own refusal means it was not saved', () => {
    for (const c of ['more_than_sold', 'no_shift', 'not_approved', 'locked', 'courier_unpaid', 'revoked']) expect(returnRefused(c)).toBe(true);
    for (const c of ['network', 'TypeError: Failed to fetch', 'signal timed out', 'HTTP 502', 'canceling statement due to statement timeout']) {
      expect(returnRefused(c), c).toBe(false);
      expect(returnErrorText(c)).toMatch(/yazılmış ola bilər/);
    }
  });
  it('the till keeps it before sending and clears it on a sure answer only', () => {
    const seller = read('app/seller/page.tsx');
    const fn = seller.slice(seller.indexOf('async function submitReturn()'), seller.indexOf('// A barcode, scanned anywhere'));
    expect(fn.indexOf('settlePendingReturn(key)')).toBeLessThan(fn.indexOf('approveReturn()'));
    expect(fn.indexOf('writePendingReturn(returnCompany(), { id: request.id')).toBeLessThan(fn.indexOf("tillPost<ReturnReply>('/api/add-return'"));
    expect(fn).toMatch(/if \(!err \|\| returnRefused\(err\)\) writePendingReturn\(returnCompany\(\), null\);/);
    const settle = seller.slice(seller.indexOf('async function settlePendingReturn'), seller.indexOf('async function submitReturn()'));
    expect(settle).toMatch(/state === 'unknown'\) \{\s+showAlert[^;]+;\s+return false;/);
  });
});

describe('a return\'s line in Kassa', () => {
  const sql = read('supabase/migrations/20261119_return_kassa_line.sql');
  it('is kept by the database, whoever writes the shift', () => {
    expect(sql).toMatch(/before update of movements on public\.cash_shifts/);
    expect(sql).toMatch(/raise exception 'is_return'/);
    expect(sql).toMatch(/revoke all on function public\.keep_return_movement\(\) from public, anon, authenticated;/);
  });
  it('admin says why, for a change and for a delete', () => {
    expect(read('app/admin/page.tsx').match(/isReturnLine\(err\) \?\?/g)).toHaveLength(2);
  });
});

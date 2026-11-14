// Qaytarma fixes found in review, 2026-11-14 (before any shop used it):
//  1. a receipt's barcode is short ("45"), and the till ignored scans under
//     four keys, so scanning a receipt did nothing unless the box had the cursor;
//  2. the exe/APK count the drawer from their own copy of the shift, and the
//     server's "Qaytarma" cash movement never reached it: short at closing;
//  3. the manager's approval was only a name the till sent; now the PIN or
//     card goes with it and the database checks it (with the lockout).
// Plus: two returns of one receipt at once wait for each other, and the same
// return sent twice at once answers "already saved".

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECEIPT_MIN_KEYS, scanCatcher } from '@/lib/barcode';
import { returnErrorText, returnMovement, returnRpcArgs } from '@/lib/returns';
import { expectedCash } from '@/lib/shift-cash';
import { RETURN_MOVEMENT as RENDERER_KIND } from '@/lib/till-write';

const read = (p: string) => readFileSync(p, 'utf8');

describe('1. a receipt barcode is a scan', () => {
  // A reader types each key ~5 ms apart and ends with Enter.
  function scan(code: string, minKeys?: () => number) {
    let t = 0;
    const got: string[] = [];
    const c = scanCatcher(x => got.push(x), () => t, minKeys);
    for (const k of code) { t += 5; c.key(k); }
    t += 5;
    c.enter();
    return got;
  }

  it('"45" is caught while Qaytarma waits for a receipt', () => {
    expect(scan('45', () => RECEIPT_MIN_KEYS)).toEqual(['45']);
    expect(scan('7/2', () => RECEIPT_MIN_KEYS)).toEqual(['7/2']);
  });

  it('elsewhere a short burst is still not a scan', () => {
    expect(scan('45')).toEqual([]);
    expect(scan('4600123456789')).toEqual(['4600123456789']);
  });

  it('a person typing "45" and Enter is not a scan, even then', () => {
    let t = 0;
    const got: string[] = [];
    const c = scanCatcher(x => got.push(x), () => t, () => RECEIPT_MIN_KEYS);
    for (const k of '45') { t += 150; c.key(k); }
    t += 150;
    c.enter();
    expect(got).toEqual([]);
  });

  it('the till lowers the bar only while a receipt is awaited', () => {
    const seller = read('app/seller/page.tsx');
    expect(seller).toMatch(/receiptWaitRef\.current = returnMode && !returnSale;/);
    expect(seller).toMatch(/receiptWaitRef\.current \? RECEIPT_MIN_KEYS : SCAN_MIN_KEYS/);
  });
});

describe('2. the exe/APK drawer counts a cash return', () => {
  const C = 'company-1';
  let dir: string;
  let till: typeof import('@/lib/till-store/write');
  let repo: typeof import('@/lib/till-store/repo');

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'till-return-'));
    vi.resetModules();
    (await import('@/electron/db')).openDb(dir);
    till = await import('@/lib/till-store/write');
    repo = await import('@/lib/till-store/repo');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('a 2.00 cash return takes 2.00 off the drawer, once, and is not sent again', () => {
    const shiftId = '11111111-1111-4111-8111-111111111111';
    till.applyWrite('shift:1', '/api/open-shift', { shiftId, openedBy: 'Aysel', openingCash: 50, openedAt: new Date(Date.now() - 1000).toISOString() }, C);
    const sent = till.outboxCount();
    const body = { movement: returnMovement('ret-1', 2, '45', 'Aysel') };
    expect(till.applyWrite('return-movement:ret-1', till.RETURN_MOVEMENT, body, C)).toEqual({ ok: true });
    expect(till.applyWrite('return-movement:ret-1', till.RETURN_MOVEMENT, body, C)).toEqual({ ok: true });
    const shift = repo.getOpenShift(C)!;
    expect(shift.movements).toHaveLength(1);
    expect(shift.movements[0]).toMatchObject({ id: 'ret-1', amount: -2, reason: 'Qaytarma · №45' });
    expect(expectedCash(shift, 0)).toBe(48);
    // The server already has it (record_return): queuing it would book it twice.
    expect(till.outboxCount()).toBe(sent);
  });

  it('the page and the store name the write the same way, and the till sends it after a cash return', () => {
    expect(RENDERER_KIND).toBe('local:returnMovement');
    const seller = read('app/seller/page.tsx');
    expect(seller).toMatch(/if \(request\.pay === 'cash'\) await noteReturnInLocalShift\(request\.id, total/);
  });

  it('the movement matches what the server writes', () => {
    expect(returnMovement('r', 3.5, null, 'Kamran', 'T')).toEqual({ id: 'r', at: 'T', amount: -3.5, reason: 'Qaytarma', by: 'Kamran' });
    const sql = read('supabase/migrations/20261114_return_approval.sql');
    expect(sql).toMatch(/'id', p_id::text, 'at', now\(\), 'amount', -tot,\s+'reason', 'Qaytarma' \|\| coalesce\(' · №' \|\| ord\.order_number, ''\)/);
  });
});

describe('3. the server checks the manager', () => {
  const sql = read('supabase/migrations/20261114_return_approval.sql');

  it('the till sends the PIN or card with the return', () => {
    const args = returnRpcArgs({ id: 'r', orderId: null, pay: 'cash', seller: 'S', approvedBy: 'M', pin: '1234', device: 'd', lines: [] }, 'c');
    expect(args).toMatchObject({ p_pin: '1234', p_card: null, p_device: 'd', p_company: 'c', p_approved_by: 'M' });
    const seller = read('app/seller/page.tsx');
    expect(seller).toMatch(/approvedBy: approver\.name, pin: approver\.pin, card: approver\.card, device: getDeviceId\(\)/);
    // A manager at the till proves it too: no "need === 'manager'" shortcut.
    expect(seller).not.toMatch(/if \(need === 'manager'\) return effectiveSeller;/);
  });

  it('checks it with the pad\'s own functions, and saves the name it finds', () => {
    expect(sql).toMatch(/verify_staff_card_in\(cid, btrim\(p_card\)/);
    expect(sql).toMatch(/verify_staff_pin_for_company\(cid, btrim\(p_pin\)/);
    expect(sql).toMatch(/check_r->>'role' <> 'manager'/);
    expect(sql).toMatch(/approver := check_r->>'name';/);
    expect(sql).toMatch(/values \(p_id, cid, p_order_id, 0\.01, p_pay, p_seller, approver\)/);
  });

  it('a wrong PIN is answered, not raised, so the lockout count is kept', () => {
    const branch = sql.slice(sql.indexOf('if check_r is not null then'), sql.indexOf("approver := check_r->>'name';"));
    expect(branch).toMatch(/return jsonb_build_object\('ok', false/);
    expect(branch).not.toMatch(/raise exception/);
  });

  it('without a PIN only an owner\'s own session, with no manager in the company; a link till never', () => {
    expect(sql).toMatch(/elsif auth\.role\(\) <> 'service_role'\s+and not exists \(select 1 from staff s where s\.company_id = cid and s\.active and s\.role = 'manager'\)\s+and exists \(select 1 from profiles p where p\.id = auth\.uid\(\) and p\.company_id = cid and p\.role = 'owner'\)/);
  });

  it('the route passes a refusal on, and the old function is gone', () => {
    const route = read('app/api/add-return/route.ts');
    expect(route).toMatch(/if \(!reply\.ok\) return Response\.json\(\{ ok: false, error: reply\.error \?\? 'not_approved' \}, \{ status: 403 \}\)/);
    expect(sql).toMatch(/drop function if exists public\.record_return\(uuid, text, jsonb, text, text, text, uuid\);/);
    expect(sql).toMatch(/revoke all on function public\.record_return\(uuid, text, jsonb, text, text, text, uuid, text, text, text\) from public, anon;/);
    expect(returnErrorText('locked')).toMatch(/yanlış cəhd/);
  });
});

describe('at the same moment', () => {
  const sql = read('supabase/migrations/20261114_return_approval.sql');
  it('two returns of one receipt wait for each other', () => {
    expect(sql).toMatch(/from orders where id = p_order_id and company_id = cid for update;/);
  });
  it('the same return twice answers "already saved"', () => {
    expect(sql).toMatch(/on conflict \(id\) do nothing;\s+get diagnostics inserted = row_count;\s+if inserted = 0 then/);
  });
});

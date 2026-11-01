// Manager cards, for real, on "restoran testing", through the routes the till
// uses (/api/verify-pin with a card, /api/public-staff): the owner saves a
// card on a manager, the till names the manager when it is tapped, a wrong card
// counts against the same five tries as a wrong PIN, one card cannot belong to
// two people, the offline till can check it from the hash the server sends, and
// nobody but the owner can save one. "Autotest menecer" is left in Kamran test
// ucun's Əməkdaşlar with the last run's card; its own pretend devices keep the
// lock off the restaurant's real tills.

import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as verifyPin } from '@/app/api/verify-pin/route';
import { GET as publicStaff } from '@/app/api/public-staff/route';
import { managerByCardOffline } from '@/lib/till-rules';
import type { Staff } from '@/types';
import { admin, anon, companyA, ownerA, ownerB, sellerA } from './setup';

const NAME = 'Autotest menecer';
const WAITER = 'Autotest menecer garson';
const device = `autotest-card-${randomUUID()}`;
let token = '';
let managerId = '';
let waiterId = '';
let pin = '';
let card = '';

const nineDigits = () => String(100_000_000 + Math.floor(Math.random() * 899_999_999));

async function tap(c: string, dev = device, tok = token) {
  const res = await verifyPin(new NextRequest('http://localhost/api/verify-pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId: companyA.id, card: c, token: tok, deviceId: dev }),
  }));
  return { status: res.status, body: await res.json() };
}

async function typePin(p: string, dev: string) {
  const res = await verifyPin(new NextRequest('http://localhost/api/verify-pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId: companyA.id, pin: p, token, deviceId: dev }),
  }));
  return (await res.json()) as { ok: boolean; error?: string };
}

async function tillStaff(tok = token) {
  const res = await publicStaff(new NextRequest(`http://localhost/api/public-staff?companyId=${companyA.id}`, {
    headers: { 'x-till-token': tok },
  }));
  return { status: res.status, body: await res.json() };
}

async function makeStaff(name: string, role: string): Promise<{ id: string; pin: string }> {
  for (let i = 0; i < 20; i++) {
    const p = String(Math.floor(Math.random() * 10_000)).padStart(4, '0');
    const { data, error } = await ownerA.rpc('create_staff', { p_name: name, p_pin: p, p_role: role });
    if (!error) return { id: data as string, pin: p };
    if (!/pin_taken/.test(error.message)) throw new Error(`create_staff: ${error.message}`);
  }
  throw new Error('no free PIN found');
}

beforeAll(async () => {
  const { data: company } = await admin.from('companies').select('seller_token').eq('id', companyA.id).single();
  token = company!.seller_token;

  // Last run's people go; the restaurant's own staff are left alone.
  await admin.from('staff').delete().eq('company_id', companyA.id).in('name', [NAME, WAITER]);
  ({ id: managerId, pin } = await makeStaff(NAME, 'manager'));
  ({ id: waiterId } = await makeStaff(WAITER, 'waiter'));

  // A card nobody in the restaurant has yet.
  for (let i = 0; i < 20 && !card; i++) {
    const c = nineDigits();
    const { error } = await ownerA.rpc('set_staff_card', { p_id: managerId, p_card: c });
    if (!error) card = c;
    else if (!/card_taken/.test(error.message)) throw new Error(`set_staff_card: ${error.message}`);
  }
  if (!card) throw new Error('no free card found');
});

afterAll(async () => {
  await admin.from('staff_pin_state').delete().like('device_id', 'autotest-card-%');
});

describe('a manager card', () => {
  it('names the manager when tapped', async () => {
    expect((await tap(card)).body).toEqual({ ok: true, id: managerId, name: NAME, role: 'manager' });
  });

  it('is refused when wrong, from the same five tries as a PIN', async () => {
    expect((await tap(nineDigits())).body).toEqual({ ok: false, error: 'wrong', attempts_left: 4 });
    expect((await tap('not a card')).body).toEqual({ ok: false, error: 'wrong', attempts_left: 3 });
  });

  it('is refused to a till without the right link', async () => {
    expect((await tap(card, device, 'wrong')).status).toBe(403);
  });

  it('five wrong taps lock the till for the card and the PIN alike', async () => {
    const dev = `autotest-card-lock-${randomUUID()}`;
    for (let i = 0; i < 4; i++) expect((await tap(nineDigits(), dev)).body.error).toBe('wrong');
    expect((await tap(nineDigits(), dev)).body.error).toBe('locked');
    expect((await tap(card, dev)).body.error).toBe('locked');
    expect((await typePin(pin, dev)).error).toBe('locked');
    expect((await tap(card, `autotest-card-other-${randomUUID()}`)).body.ok).toBe(true);
  });

  it('cannot be given to a second person, and must be a card number', async () => {
    expect((await ownerA.rpc('set_staff_card', { p_id: waiterId, p_card: card })).error?.message).toMatch(/card_taken/);
    expect((await ownerA.rpc('set_staff_card', { p_id: waiterId, p_card: '12ab' })).error?.message).toMatch(/bad_card/);
    expect((await ownerA.rpc('set_staff_card', { p_id: waiterId, p_card: '0123' })).error?.message).toMatch(/bad_card/);
  });

  it('is saved by the owner only', async () => {
    const other = nineDigits();
    expect((await sellerA.rpc('set_staff_card', { p_id: managerId, p_card: other })).error?.message).toMatch(/not_owner/);
    expect((await anon.rpc('set_staff_card', { p_id: managerId, p_card: other })).error).not.toBeNull();
    // Another restaurant's owner finds nobody of ours to change.
    expect((await ownerB.rpc('set_staff_card', { p_id: managerId, p_card: other })).error).toBeNull();
    expect((await ownerB.rpc('set_staff_card', { p_id: managerId, p_card: '' })).error).toBeNull();
    expect((await tap(card, `autotest-card-${randomUUID()}`)).body.ok).toBe(true);
    expect((await tap(other, `autotest-card-${randomUUID()}`)).body.ok).toBe(false);
  });

  it('is never readable straight from the database', async () => {
    for (const who of [ownerA, sellerA, ownerB, anon]) {
      const { data, error } = await who.from('staff').select('card_hash').eq('id', managerId);
      expect(error !== null || !data?.length).toBe(true);
    }
  });

  it('reaches the till as a hash it can check offline, for managers only', async () => {
    const r = await tillStaff();
    expect(r.status).toBe(200);
    const staff = r.body.staff as Staff[];
    const manager = staff.find(s => s.id === managerId)!;
    expect(manager.cardHash).toMatch(/^\$2[aby]\$08\$/);
    expect(manager.cardHash).not.toContain(card);
    expect((await managerByCardOffline(card, staff))?.id).toBe(managerId);
    expect(await managerByCardOffline(nineDigits(), staff)).toBeNull();

    // A waiter's card never leaves the server: it approves nothing.
    await ownerA.rpc('set_staff_card', { p_id: waiterId, p_card: nineDigits() });
    expect(staff.find(s => s.id === waiterId)?.cardHash).toBeUndefined();
    expect((await tillStaff()).body.staff.find((s: Staff) => s.id === waiterId).cardHash).toBeUndefined();

    expect((await tillStaff('wrong')).status).toBe(403);
  });

  it('stops working once the manager is switched off or the card is cleared', async () => {
    await admin.from('staff').update({ active: false }).eq('id', managerId);
    expect((await tap(card, `autotest-card-${randomUUID()}`)).body.ok).toBe(false);
    expect((await tillStaff()).body.staff.find((s: Staff) => s.id === managerId)?.cardHash).toBeUndefined();
    await admin.from('staff').update({ active: true }).eq('id', managerId);

    expect((await ownerA.rpc('set_staff_card', { p_id: managerId, p_card: '' })).error).toBeNull();
    expect((await tap(card, `autotest-card-${randomUUID()}`)).body.ok).toBe(false);
    // Put back, so the manager shows a card in Əməkdaşlar.
    expect((await ownerA.rpc('set_staff_card', { p_id: managerId, p_card: card })).error).toBeNull();
  });
});

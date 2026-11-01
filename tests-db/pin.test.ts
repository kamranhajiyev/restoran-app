// Staff PINs, for real, on "restoran testing", through the route the till uses
// (/api/verify-pin): the right PIN names the waiter, a wrong one does not, five
// wrong ones lock the till, and nobody can read a PIN back. The test waiter
// "Autotest garson" is left in Kamran test ucun's Əməkdaşlar to look at. Its own
// pretend device keeps the lock off the restaurant's real tills.

import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as verifyPin } from '@/app/api/verify-pin/route';
import { admin, anon, companyA, ownerA, ownerB, sellerA } from './setup';

const NAME = 'Autotest garson';
const device = `autotest-${randomUUID()}`;
let token = '';
let pin = '';
let staffId = '';
const wrongPins: string[] = [];

async function tryPin(p: string, dev = device, tok = token) {
  const res = await verifyPin(new NextRequest('http://localhost/api/verify-pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId: companyA.id, pin: p, token: tok, deviceId: dev }),
  }));
  return { status: res.status, body: await res.json() };
}

const fourDigits = () => String(Math.floor(Math.random() * 10_000)).padStart(4, '0');

beforeAll(async () => {
  const { data: company } = await admin.from('companies').select('seller_token').eq('id', companyA.id).single();
  token = company!.seller_token;

  // Last run's waiter goes; any other staff of the restaurant is left alone.
  await admin.from('staff').delete().eq('company_id', companyA.id).eq('name', NAME);
  for (let i = 0; i < 20 && !staffId; i++) {
    pin = fourDigits();
    const { data, error } = await ownerA.rpc('create_staff', { p_name: NAME, p_pin: pin, p_role: 'waiter' });
    if (!error) staffId = data as string;
    else if (!/pin_taken/.test(error.message)) throw new Error(`create_staff: ${error.message}`);
  }
  if (!staffId) throw new Error('no free PIN found');

  // "Wrong" PINs that are nobody's: checked once each on a throwaway device.
  const scratch = `autotest-scratch-${randomUUID()}`;
  while (wrongPins.length < 6) {
    const p = fourDigits();
    if (p === pin || wrongPins.includes(p)) continue;
    if (!(await tryPin(p, scratch)).body.ok) wrongPins.push(p);
    if (wrongPins.length % 4 === 0) await admin.from('staff_pin_state').delete().eq('device_id', scratch);
  }
  await admin.from('staff_pin_state').delete().eq('device_id', scratch);
});

afterAll(async () => {
  await admin.from('staff_pin_state').delete().like('device_id', 'autotest-%');
});

describe('a staff PIN', () => {
  it('names the waiter it belongs to', async () => {
    expect((await tryPin(pin)).body).toEqual({ ok: true, id: staffId, name: NAME, role: 'waiter' });
  });

  it('is refused when wrong, saying how many tries are left', async () => {
    expect((await tryPin(wrongPins[0])).body).toEqual({ ok: false, error: 'wrong', attempts_left: 4 });
  });

  it('is refused to a till without the right link, even when right', async () => {
    expect((await tryPin(pin, device, 'wrong')).status).toBe(403);
  });

  it('locks the till after five wrong tries, even for the right PIN', async () => {
    const dev = `autotest-lock-${randomUUID()}`;
    for (const p of wrongPins.slice(0, 4)) expect((await tryPin(p, dev)).body.error).toBe('wrong');
    expect((await tryPin(wrongPins[4], dev)).body.error).toBe('locked');
    expect((await tryPin(pin, dev)).body.error).toBe('locked');
  });

  it("locks only that till: another one still takes the right PIN", async () => {
    expect((await tryPin(pin, `autotest-other-${randomUUID()}`)).body.ok).toBe(true);
  });

  it('is never readable: not by the owner, the seller, another restaurant or a stranger', async () => {
    for (const who of [ownerA, sellerA, ownerB, anon]) {
      const { data, error } = await who.from('staff').select('pin_hash').eq('id', staffId);
      expect(error !== null || !data?.length).toBe(true);
      const approve = await who.from('staff').select('approve_hash').eq('id', staffId);
      expect(approve.error !== null || !approve.data?.length).toBe(true);
    }
  });

  it("is set only by the restaurant's owner", async () => {
    // The seller and the stranger are refused outright. Another restaurant's
    // owner is an owner, so set_staff_pin runs, but only on its own staff: 0 rows.
    for (const who of [sellerA, anon]) {
      expect((await who.rpc('set_staff_pin', { p_id: staffId, p_pin: wrongPins[5] })).error).not.toBeNull();
    }
    await ownerB.rpc('set_staff_pin', { p_id: staffId, p_pin: wrongPins[5] });
    expect((await tryPin(wrongPins[5], `autotest-after-${randomUUID()}`)).body.ok).toBe(false);
    expect((await tryPin(pin, `autotest-after-${randomUUID()}`)).body.ok).toBe(true);
  });
});

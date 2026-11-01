// Shift money that Maliyyə reads changes only by the owner's hand, for real,
// on "restoran testing" (20261021_shift_owner_lock.sql): a signed-in seller may
// open a shift empty, add movements to an open one and close it once, but not
// change what it opened with, change or drop a movement already written, or
// touch a closed shift. The owner may correct it; another restaurant's owner
// and a stranger reach nothing. The shifts are opened by "autotest-kilid" and
// removed before and after; a shift of Kamran test ucun's own stops the test.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, anon, companyA, ownerA, ownerB, sellerA } from './setup';

const BY = 'autotest-kilid';
const shiftId = randomUUID();
const move = (amount: number, reason: string) => ({ id: randomUUID(), at: new Date().toISOString(), amount, reason, by: BY });
const m1 = move(20, 'xırda pul');
const m2 = move(-5, 'buz');

const shift = async () => (await admin.from('cash_shifts').select('*').eq('id', shiftId).single()).data!;
const change = (who: typeof sellerA, patch: Record<string, unknown>) => who.from('cash_shifts').update(patch).eq('id', shiftId);

async function cleanUp() {
  await admin.from('cash_shifts').delete().eq('company_id', companyA.id).eq('opened_by', BY);
}

beforeAll(async () => {
  const { data: open } = await admin.from('cash_shifts').select('opened_by').eq('company_id', companyA.id).is('closed_at', null);
  if (open?.some(s => s.opened_by !== BY)) throw new Error('Kamran test ucun has a shift open that is not the test\'s: close it first, it is left alone');
  await cleanUp();
});

afterAll(cleanUp);

describe('a shift, for the seller', () => {
  it('opens only empty', async () => {
    const closed = await sellerA.from('cash_shifts').insert({
      id: randomUUID(), company_id: companyA.id, opened_at: new Date().toISOString(), opened_by: BY, opening_cash: 50,
      closed_at: new Date().toISOString(), counted_cash: 50,
    });
    expect(closed.error?.message).toMatch(/owner_only/);
    const withMoney = await sellerA.from('cash_shifts').insert({
      id: randomUUID(), company_id: companyA.id, opened_at: new Date().toISOString(), opened_by: BY, opening_cash: 50, movements: [m1],
    });
    expect(withMoney.error?.message).toMatch(/owner_only/);

    const ok = await sellerA.from('cash_shifts').insert({
      id: shiftId, company_id: companyA.id, opened_at: new Date().toISOString(), opened_by: BY, opening_cash: 50,
    });
    expect(ok.error).toBeNull();
  });

  it('takes movements, one after another', async () => {
    expect((await change(sellerA, { movements: [m1] })).error).toBeNull();
    expect((await change(sellerA, { movements: [m1, m2] })).error).toBeNull();
    expect((await shift()).movements).toEqual([m1, m2]);
  });

  it('never changes or drops a movement already written, nor what it opened with', async () => {
    expect((await change(sellerA, { movements: [m2] })).error?.message).toMatch(/owner_only/);
    expect((await change(sellerA, { movements: [{ ...m1, amount: 2 }, m2] })).error?.message).toMatch(/owner_only/);
    expect((await change(sellerA, { movements: [m2, m1] })).error?.message).toMatch(/owner_only/);
    expect((await change(sellerA, { opening_cash: 500 })).error?.message).toMatch(/owner_only/);
    const s = await shift();
    expect(s.movements).toEqual([m1, m2]);
    expect(Number(s.opening_cash)).toBe(50);
  });

  it('closes once, then is never touched again', async () => {
    expect((await change(sellerA, { closed_at: new Date().toISOString(), closed_by: BY, expected_cash: 65, counted_cash: 65 })).error).toBeNull();
    expect((await change(sellerA, { counted_cash: 1000 })).error?.message).toMatch(/owner_only: the shift is closed/);
    expect((await change(sellerA, { movements: [m1, m2, move(-60, 'götürdüm')] })).error?.message).toMatch(/owner_only/);
    expect(Number((await shift()).counted_cash)).toBe(65);
  });
});

describe('a closed shift', () => {
  it('is reached by no other restaurant and no stranger', async () => {
    for (const who of [ownerB, anon]) {
      await change(who, { counted_cash: 1 });
      expect((await who.from('cash_shifts').select('id').eq('id', shiftId)).data ?? []).toEqual([]);
    }
    expect(Number((await shift()).counted_cash)).toBe(65);
  });

  it('is corrected by the owner', async () => {
    expect((await change(ownerA, { counted_cash: 64 })).error).toBeNull();
    expect(Number((await shift()).counted_cash)).toBe(64);
  });
});

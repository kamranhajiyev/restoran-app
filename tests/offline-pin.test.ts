// 2026-11-01: unlocking the till with a PIN when the internet is down
// (lib/offline-pin.ts) had no test. A waiter locked out mid-outage is the
// feature failing at the worst moment; a till that lets any PIN in, or keeps
// a stolen machine's PINs working for good, is worse.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
});

const { forgetPins, rememberPin, verifyPinOffline } = await import('@/lib/offline-pin');

const A = 'company-a';
const B = 'company-b';
const aysel = { id: 'staff-1', name: 'Aysel' };
const murad = { id: 'staff-2', name: 'Murad' };

beforeEach(() => store.clear());
afterEach(() => vi.useRealTimers());

describe('an offline PIN', () => {
  it('lets in a waiter who unlocked online on this till', async () => {
    await rememberPin('1234', aysel, A);
    expect(await verifyPinOffline('1234', A)).toEqual({ ok: true, id: 'staff-1', name: 'Aysel' });
  });

  it('refuses a wrong PIN', async () => {
    await rememberPin('1234', aysel, A);
    expect(await verifyPinOffline('1235', A)).toEqual({ ok: false, error: 'wrong' });
  });

  it('says "unavailable", not "wrong", when nobody unlocked on this till yet', async () => {
    expect(await verifyPinOffline('1234', A)).toEqual({ ok: false, error: 'unavailable' });
  });

  it("does not open another restaurant's till", async () => {
    await rememberPin('1234', aysel, A);
    expect(await verifyPinOffline('1234', B)).toEqual({ ok: false, error: 'unavailable' });
  });

  it('tells two waiters apart', async () => {
    await rememberPin('1111', aysel, A);
    await rememberPin('2222', murad, A);
    expect(await verifyPinOffline('2222', A)).toMatchObject({ ok: true, id: 'staff-2' });
    expect(await verifyPinOffline('1111', A)).toMatchObject({ ok: true, id: 'staff-1' });
  });

  it("forgets a waiter's old PIN once it changes", async () => {
    await rememberPin('1111', aysel, A);
    await rememberPin('9999', aysel, A);
    expect(await verifyPinOffline('1111', A)).toEqual({ ok: false, error: 'wrong' });
    expect(await verifyPinOffline('9999', A)).toMatchObject({ ok: true, id: 'staff-1' });
  });

  it('never keeps the PIN itself on the machine', async () => {
    await rememberPin('4821', aysel, A);
    expect([...store.values()].join()).not.toContain('4821');
  });

  it('stops working after one long shift, so a stolen till is no key', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await rememberPin('1234', aysel, A);
    vi.setSystemTime(Date.now() + 15 * 60 * 60 * 1000);
    expect(await verifyPinOffline('1234', A)).toMatchObject({ ok: true });
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
    expect(await verifyPinOffline('1234', A)).toEqual({ ok: false, error: 'unavailable' });
  });

  it('is gone after signing out of the till', async () => {
    await rememberPin('1234', aysel, A);
    forgetPins();
    expect(await verifyPinOffline('1234', A)).toEqual({ ok: false, error: 'unavailable' });
  });
});

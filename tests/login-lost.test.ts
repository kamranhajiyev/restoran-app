// Natiq pressed Çıxış on the laptop; the phone till signed in as the same
// "owner" was logged out with it. It kept its old pass for two hours, then the
// server answered every ticket claim with 401 and the till kept asking, printing
// nothing and showing nothing (Test Restoran, 2026-10-21).

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
const refreshSession = vi.fn();
const channel = { on: () => channel, subscribe: () => channel };

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    auth: { refreshSession: () => refreshSession() },
    channel: () => channel,
    removeChannel: async () => {},
  },
}));

function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
  };
}

beforeEach(() => {
  vi.stubGlobal('window', { posNative: { isDesktop: true, print: async () => {} } });
  vi.stubGlobal('localStorage', storage());
  vi.stubGlobal('navigator', {});
  rpc.mockReset();
  refreshSession.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

const claimRefused = () => rpc.mockResolvedValue({ data: null, error: { message: 'JWT expired' }, status: 401 });

async function start(lost: () => void) {
  const { startKitchenPrinting, drainPrintQueue } = await import('@/lib/desktopPrint');
  const stop = startKitchenPrinting({ kind: 'session', companyId: 'c1' }, lost);
  await drainPrintQueue();
  await new Promise(r => setTimeout(r, 0));
  return stop;
}

describe('a till whose login the server refuses', () => {
  it('sends staff to log in when the login cannot be renewed', async () => {
    claimRefused();
    refreshSession.mockResolvedValue({ data: { session: null }, error: { name: 'AuthApiError', status: 400 } });
    const lost = vi.fn();
    const stop = await start(lost);
    stop();
    expect(lost).toHaveBeenCalled();
  });

  it('carries on without a fuss when one refresh brings it back', async () => {
    claimRefused();
    refreshSession.mockResolvedValue({ data: { session: { access_token: 'new' } }, error: null });
    const lost = vi.fn();
    const stop = await start(lost);
    stop();
    expect(lost).not.toHaveBeenCalled();
  });

  it('is not sent to log in for a claim that failed some other way', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'timeout' }, status: 0 });
    const lost = vi.fn();
    const stop = await start(lost);
    stop();
    expect(refreshSession).not.toHaveBeenCalled();
    expect(lost).not.toHaveBeenCalled();
  });
});

describe('Çıxış', () => {
  it('logs out this device only, not every device on the account', () => {
    const src = readFileSync('lib/auth.ts', 'utf8');
    const logout = src.slice(src.indexOf('export function logout'));
    expect(logout).toMatch(/signOut\(\{ scope: 'local' \}\)/);
  });

  it('the seller page goes to the login screen when the print queue says so', () => {
    const src = readFileSync('app/seller/page.tsx', 'utf8');
    expect(src).toMatch(/startKitchenPrinting\(\{ kind: 'session', companyId \}, \(\) => \{ clearLocalSession\(\); router\.replace\('\/login'\); \}\)/);
  });
});

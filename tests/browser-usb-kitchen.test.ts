// 2026-10-30: a sex set to "USB" printed on the till's receipt printer only in
// the exe and the Android app. In the browser till nothing collected its
// tickets, so a café with one USB printer got the receipt and no kitchen slip.
// Now the browser collects those sexes' tickets — and only theirs, and only
// with a USB printer plugged in, so the network ones stay with the exe.

import { afterEach, describe, expect, it, vi } from 'vitest';

type Call = { table: string; op: 'select' | 'update'; patch?: Record<string, unknown>; filters: [string, string, unknown][] };

const calls: Call[] = [];
const rpc = vi.fn(async () => ({ data: [], error: null, status: 200 }));

const STATIONS = [
  { id: 'bar', name: 'Bar', printer_ip: 'usb', printer_port: 9100 },
  { id: 'kitchen', name: 'Mətbəx', printer_ip: '192.168.1.50', printer_port: 9100 },
];
const JOB = { id: 'j1', station_id: 'bar', order_id: 'o1', kind: 'new', payload: {}, attempts: 0, created_at: '2026-10-30T10:00:00Z' };

function answer(q: Call) {
  if (q.table === 'stations') return STATIONS;
  if (q.table !== 'print_jobs') return [];
  if (q.op === 'select') return [{ id: 'j1' }];
  return q.patch?.status === 'printing' ? [JOB] : [];
}

function from(table: string) {
  const q: Call = { table, op: 'select', filters: [] };
  const b = {
    select: () => b,
    update: (patch: Record<string, unknown>) => { q.op = 'update'; q.patch = patch; return b; },
    eq: (c: string, v: unknown) => { q.filters.push(['eq', c, v]); return b; },
    in: (c: string, v: unknown) => { q.filters.push(['in', c, v]); return b; },
    lt: () => b, gte: () => b, order: () => b, limit: () => b,
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      calls.push(q);
      return Promise.resolve({ data: answer(q), error: null, status: 200 }).then(ok, bad);
    },
  };
  return b;
}

vi.mock('@/lib/supabase', () => {
  const channel = { on: () => channel, subscribe: () => channel };
  return { supabase: { from, rpc, channel: () => channel, removeChannel: async () => {} } };
});
vi.mock('@/lib/station-ticket', () => ({ buildStationTicketRaster: async () => new Uint8Array([9]) }));

function till(opts: { printer: boolean; exe?: boolean }) {
  const sent: number[][] = [];
  const device = {
    productName: 'XP-S200M',
    open: async () => {},
    configuration: { interfaces: [{ interfaceNumber: 0, alternates: [{ endpoints: [{ direction: 'out', type: 'bulk', endpointNumber: 1 }] }] }] },
    claimInterface: async () => {},
    transferOut: async (_e: number, b: Uint8Array) => { sent.push([...b]); },
  };
  const data = new Map<string, string>();
  vi.stubGlobal('window', opts.exe ? { posNative: { isDesktop: true, print: async () => {} } } : {});
  vi.stubGlobal('navigator', { usb: { getDevices: async () => (opts.printer ? [device] : []) } });
  vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } });
  return { sent };
}

const claims = () => calls.filter(c => c.table === 'print_jobs' && c.patch?.status === 'printing');

afterEach(() => { calls.length = 0; rpc.mockClear(); vi.unstubAllGlobals(); vi.resetModules(); });

describe('a browser till with a USB printer', () => {
  it('prints the USB sex’s ticket and leaves the network sex’s to the exe', async () => {
    const { sent } = till({ printer: true });
    const { startKitchenPrinting } = await import('@/lib/desktopPrint');
    const stop = startKitchenPrinting({ kind: 'session', companyId: 'c1' });
    await vi.waitFor(() => expect(calls.some(c => c.patch?.status === 'printed')).toBe(true));
    stop();

    expect(sent).toEqual([[9]]);
    expect(rpc).not.toHaveBeenCalled();
    for (const c of calls.filter(c => c.table === 'print_jobs' && c.op === 'select')) {
      expect(c.filters).toContainEqual(['in', 'station_id', ['bar']]);
    }
    expect(claims()).toHaveLength(1);
  });

  it('takes no ticket when no printer is plugged in', async () => {
    till({ printer: false });
    const { startKitchenPrinting, drainPrintQueue } = await import('@/lib/desktopPrint');
    const stop = startKitchenPrinting({ kind: 'session', companyId: 'c1' });
    await drainPrintQueue();
    await new Promise(r => setTimeout(r, 10));
    stop();
    expect(claims()).toHaveLength(0);
  });
});

describe('the exe', () => {
  it('still claims every sex’s tickets through claim_print_jobs', async () => {
    till({ printer: true, exe: true });
    const { startKitchenPrinting } = await import('@/lib/desktopPrint');
    const stop = startKitchenPrinting({ kind: 'session', companyId: 'c1' });
    await vi.waitFor(() => expect(rpc).toHaveBeenCalled());
    stop();
    expect(claims()).toHaveLength(0);
  });
});

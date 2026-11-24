// Natiq, Test Restoran PR, 2026-11-23: the exe (USB printer) and the Android app
// (no printer) were open together. Both heard of a kitchen slip; when the phone
// claimed it first it could not print it, and the slip went back to the queue
// for up to three minutes. After five such tries it would never have printed.
// Only an app with a printer of its own takes a "USB" sex's slips.

import { afterEach, describe, expect, it, vi } from 'vitest';

type Job = { id: string; station_id: string; order_id: string; kind: string; payload: object; attempts: number };

const STATIONS = [
  { id: 'bar', name: 'Bar', printerIp: 'usb', printerPort: 9100 },
  { id: 'kitchen', name: 'Mətbəx', printerIp: '192.168.1.50', printerPort: 9100 },
];

let stationsFail = false;
let queue: Job[] = [];
const claimed: { stationIds?: string[] }[] = [];
const reports: { id: string; outcome: { result: string } }[] = [];

// The server's claim: every pending slip, or only these sexes'.
const tillPost = vi.fn(async (path: string, body: Record<string, unknown>) => {
  if (path === '/api/report-print-job') { reports.push(body as (typeof reports)[number]); return { ok: true }; }
  const only = body.stationIds as string[] | undefined;
  claimed.push({ stationIds: only });
  const jobs = queue.filter(j => !only || only.includes(j.station_id));
  queue = queue.filter(j => !jobs.includes(j));
  return { ok: true, jobs };
});

vi.mock('@/lib/supabase', () => {
  const channel = { on: () => channel, subscribe: () => channel };
  return { supabase: { channel: () => channel, removeChannel: async () => {} } };
});
vi.mock('@/lib/till-write', () => ({ tillPost }));
vi.mock('@/lib/till-data', () => ({
  siteGet: async (path: string) => stationsFail ? Promise.reject(new Error('offline')) : ({ json: async () => (path.startsWith('/api/public-stations') ? { stations: STATIONS } : {}) }),
}));
vi.mock('@/lib/station-ticket', () => ({ buildStationTicketRaster: async () => new Uint8Array([9]) }));

const job = (id: string, station_id: string): Job => ({ id, station_id, order_id: 'o1', kind: 'cancel', payload: {}, attempts: 0 });

function app(opts: { webUsb: boolean; plugged?: boolean; works?: boolean; saved?: Record<string, string> }) {
  const usb: number[][] = [], lan: string[] = [];
  const device = {
    open: async () => { if (opts.works === false) throw new Error('busy'); },
    close: async () => {}, releaseInterface: async () => {},
    configuration: { interfaces: [{ interfaceNumber: 0, alternates: [{ endpoints: [{ direction: 'out', type: 'bulk', endpointNumber: 1 }] }] }] },
    claimInterface: async () => {},
    transferOut: async (_e: number, b: Uint8Array) => { usb.push([...b]); },
  };
  const data = new Map(Object.entries(opts.saved ?? {}));
  vi.stubGlobal('window', { posNative: { isDesktop: true, print: async (ip: string) => { lan.push(ip); } } });
  vi.stubGlobal('navigator', opts.webUsb ? { usb: { getDevices: async () => (opts.plugged ? [device] : []) } } : {});
  vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } });
  return { usb, lan, data };
}

async function collect() {
  const { startKitchenPrinting, drainPrintQueue } = await import('@/lib/desktopPrint');
  const stop = startKitchenPrinting({ kind: 'link', companyId: 'c1', token: 't' });
  await vi.waitFor(() => expect(claimed.length).toBeGreaterThan(0));
  await drainPrintQueue();
  await new Promise(r => setTimeout(r, 20));
  stop();
}

afterEach(() => { stationsFail = false; queue = []; claimed.length = 0; reports.length = 0; vi.unstubAllGlobals(); vi.resetModules(); });

describe('the slips of a sex set to "USB"', () => {
  it('are left by a phone with no printer, which still prints the network ones', async () => {
    const { lan } = app({ webUsb: false });
    queue = [job('b', 'bar'), job('k', 'kitchen')];
    await collect();
    expect(queue.map(j => j.id)).toEqual(['b']);
    expect(lan).toEqual(['192.168.1.50']);
    expect(reports.map(r => [r.id, r.outcome.result])).toEqual([['k', 'printed']]);
  });

  it('are printed by a phone that has its own receipt printer', async () => {
    const { lan } = app({ webUsb: false, saved: { restoran_receipt_printer_ip: '192.168.1.60' } });
    queue = [job('b', 'bar')];
    await collect();
    expect(lan).toEqual(['192.168.1.60']);
    expect(claimed[0].stationIds).toBeUndefined();
  });

  it('are printed by the exe with the printer on its cable', async () => {
    const { usb, data } = app({ webUsb: true, plugged: true });
    queue = [job('b', 'bar'), job('k', 'kitchen')];
    await collect();
    expect(usb).toEqual([[9]]);
    expect(queue).toEqual([]);
    expect(data.get('restoran_usb_printer_seen')).toBe('1');
  });

  it('are left by an exe that never had a USB printer', async () => {
    app({ webUsb: true });
    queue = [job('b', 'bar')];
    await collect();
    expect(queue.map(j => j.id)).toEqual(['b']);
    expect(reports).toEqual([]);
  });

  it('still fail out loud on the exe whose printer is unplugged or busy today', async () => {
    app({ webUsb: true, saved: { restoran_usb_printer_seen: '1' } });
    queue = [job('b', 'bar')];
    await collect();
    expect(reports.map(r => r.outcome.result)).toEqual(['failed']);
  });
});

it('a till whose sexes are all on the network claims everything, as before', async () => {
  const usbStation = STATIONS.shift()!;
  try {
    app({ webUsb: false });
    queue = [job('k', 'kitchen')];
    await collect();
    expect(claimed[0].stationIds).toBeUndefined();
  } finally { STATIONS.unshift(usbStation); }
});

it('a till that could not read the sexes goes on asking, and gives the slip back uncounted', async () => {
  app({ webUsb: false });
  stationsFail = true;
  queue = [job('b', 'bar')];
  await collect();
  expect(claimed[0].stationIds).toBeUndefined();
  expect(reports.map(r => r.outcome.result)).toEqual(['release']);
});

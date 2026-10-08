// Code review, 2026-10-08: a station's printer IP can be set from the till
// (/api/update-station-printer) while admin is open. Admin saved its whole
// station list, old IP included, on any rename or new station — the till's IP
// was undone and the kitchen tickets stopped coming out.

import { describe, expect, it, vi } from 'vitest';

const upserts: Record<string, unknown>[][] = [];
let stationRows: Record<string, unknown>[] = [];

vi.mock('@/lib/supabase', () => {
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {};
    for (const k of ['select', 'order', 'eq', 'not', 'in']) c[k] = () => c;
    c.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
    return c;
  };
  return {
    supabase: {
      from: () => ({
        select: () => chain({ data: stationRows, error: null }),
        upsert: async (rows: Record<string, unknown>[]) => { upserts.push(rows); return { error: null }; },
        delete: () => chain({ error: null }),
      }),
    },
  };
});

import { fetchStations, saveStations, setCompanyContext } from '@/lib/store';

const KITCHEN = '11111111-1111-4111-8111-111111111111';
const BAR = '22222222-2222-4222-8222-222222222222';

describe('saving stations in admin', () => {
  it('does not write back an IP it did not change', async () => {
    setCompanyContext('c1');
    stationRows = [
      { id: KITCHEN, name: 'Mətbəx', printer_ip: null, printer_port: 9100 },
      { id: BAR, name: 'Bar', printer_ip: '192.168.1.20', printer_port: 9100 },
    ];
    const shown = await fetchStations();
    // Meanwhile the till sets the kitchen printer. Admin renames the bar and
    // gives it a new printer.
    const next = shown.map(s => s.id === BAR ? { ...s, name: 'Bar 2', printerIp: '192.168.1.30' } : s);
    expect(await saveStations(next)).toBeNull();

    const written = upserts.flat();
    const kitchen = written.find(r => r.id === KITCHEN)!;
    const bar = written.find(r => r.id === BAR)!;
    expect('printer_ip' in kitchen).toBe(false);
    expect(bar.printer_ip).toBe('192.168.1.30');
    // No batch mixes rows with and without the column.
    for (const batch of upserts) {
      expect(new Set(batch.map(r => 'printer_ip' in r)).size).toBe(1);
    }
  });

  it('writes the IP of a new station', async () => {
    upserts.length = 0;
    const shown = await fetchStations();
    const NEW = '33333333-3333-4333-8333-333333333333';
    await saveStations([...shown, { id: NEW, name: 'Pizza', printerIp: null, printerPort: 9100 }]);
    expect(upserts.flat().find(r => r.id === NEW)).toHaveProperty('printer_ip', null);
  });
});

// The cook asked for the guest's note to stand out (2026-10-05): Qeyd prints
// 1.3x taller than the phone and address, and stays smaller than the dish names.

import { describe, expect, it, vi } from 'vitest';
import type { Line } from '@/lib/raster';

const drawn: Line[][] = [];
vi.mock('@/lib/raster', () => ({ rasterize: (lines: Line[]) => { drawn.push(lines); return new Uint8Array(); } }));

describe('Qeyd size on the exe ticket', () => {
  it('prints Qeyd at 1.3x height, phone and address normal', async () => {
    const { buildStationTicketRaster } = await import('@/lib/station-ticket');
    buildStationTicketRaster({
      kind: 'new', station: 'Bar', orderNumber: 1, table: null, waiter: null, online: true,
      at: '2026-10-05T10:00:00Z', items: [{ name: 'Ayran', qty: 3 }],
      note: 'Tel: 050 · Ünvan: Gəncə · az buzlu',
    });
    const lines = drawn[0];
    const find = (s: string) => lines.find(l => l.text.startsWith(s))!;
    expect(find('Tel:').scale).toBeUndefined();
    expect(find('Ünvan:').scale).toBeUndefined();
    expect(find('Qeyd:').scale).toEqual([1, 1.3]);
    expect(find('3x').scale![1]).toBeGreaterThan(1.3);
  });
});

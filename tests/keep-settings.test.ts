// 2026-10-08: in the exe Tarixçə went back to the top every few minutes. Each
// pull re-read the company settings into a new object, and Tarixçə reloads
// whenever its settings object changes — "Yüklənir...", list gone, scroll lost.
// A re-read that says the same thing must keep the old object.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { keepSettings } from '@/lib/business-day';

const day = { timezone: 'Asia/Baku', workOpen: '10:00', workClose: '02:00' };

describe('company settings after a re-read', () => {
  it('keep the old object when nothing changed', () => {
    const prev = { ...day };
    expect(keepSettings(prev, { ...day })).toBe(prev);
  });

  it('take the new ones when the hours or the timezone changed', () => {
    const prev = { ...day };
    const later = { ...day, workClose: '03:00' };
    expect(keepSettings(prev, later)).toBe(later);
    const moved = { ...day, timezone: 'Europe/Istanbul' };
    expect(keepSettings(prev, moved)).toBe(moved);
  });
});

describe('the seller page', () => {
  const seller = readFileSync('app/seller/page.tsx', 'utf8');

  it('never swaps in a fresh settings object on a re-read', () => {
    expect(seller).not.toMatch(/\.then\(setBizSettings\)/);
    expect(seller.match(/setBizSettings\(prev => keepSettings\(prev, next\)\)/g)?.length).toBe(2);
  });
});

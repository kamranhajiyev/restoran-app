// Every date reads day, month, year: "24.10.2026 13:15". Chrome and the exe have
// no Azerbaijani date data, so toLocaleString('az-AZ') printed "2026-10-24 13:15"
// on Natiq's Hesabat (2026-10-24), while Node, which has it, passed the tests.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDate, formatDateTime, formatDayMonth, formatDayMonthTime, formatTime } from '@/lib/dates';
import { historyReport, historyReportLines } from '@/lib/history-report';

const at = '2026-10-24T09:15:00Z'; // 13:15 in Baku

describe('dates', () => {
  afterEach(() => vi.restoreAllMocks());

  it('puts the day first', () => {
    expect(formatDate(at, 'Asia/Baku')).toBe('24.10.2026');
    expect(formatDateTime(at, 'Asia/Baku')).toBe('24.10.2026 13:15');
    expect(formatDayMonth(at, 'Asia/Baku')).toBe('24.10');
    expect(formatDayMonthTime(at, 'Asia/Baku')).toBe('24.10 13:15');
    expect(formatTime(at, 'Asia/Baku')).toBe('13:15');
  });

  it('reads the day in the given timezone, and midnight as 00', () => {
    expect(formatDateTime('2026-10-24T20:30:00Z', 'Asia/Baku')).toBe('25.10.2026 00:30');
  });

  it('gives nothing for a missing date, and survives an unknown timezone', () => {
    expect(formatDateTime('')).toBe('');
    expect(formatDate(at, 'Not/AZone')).toMatch(/^\d\d\.\d\d\.2026$/);
  });

  it('prints the Hesabat without the browser\'s own date words', () => {
    // what a browser without Azerbaijani data does: the code must not ask it
    for (const m of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'] as const) {
      vi.spyOn(Date.prototype, m).mockImplementation(() => '2026-10-24 13:15');
    }
    const text = historyReportLines(historyReport([], () => 0), {
      companyName: 'Test Restoran PR', from: at, to: '2026-10-24T16:13:00Z',
      printedBy: 'Natiq', timezone: 'Asia/Baku',
    }).map(l => l.text).join('\n');
    expect(text).toContain('Hesabat 24.10.2026');
    expect(text).toMatch(/Başlanğıc\s+24\.10\.2026 13:15/);
    expect(text).toMatch(/Son\s+24\.10\.2026 20:13/);
  });

  it('no screen formats a date on its own', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(n)) files.push(p);
      }
    };
    ['app', 'components', 'lib', 'electron'].forEach(walk);
    const own = files.filter(f => /\.toLocale(Date|Time)?String\(/.test(readFileSync(f, 'utf8')));
    expect(own).toEqual([]);
  });
});

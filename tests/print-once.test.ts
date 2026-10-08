// 2026-10-08: a kitchen ticket whose "printed" report was lost on a blip stayed
// claimed; two minutes later the server handed it out again and it printed
// twice. The till remembers what it printed and only reports it again.

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
});

const { wasPrinted, markPrinted } = await import('@/lib/printed-jobs');

describe('a kitchen ticket', () => {
  it('is remembered once printed', () => {
    expect(wasPrinted('j1')).toBe(false);
    markPrinted('j1');
    expect(wasPrinted('j1')).toBe(true);
  });

  it('is reported again, not printed again, when handed out a second time', () => {
    const src = readFileSync('lib/desktopPrint.ts', 'utf8');
    const run = src.slice(src.indexOf('async function runJob'));
    expect(run.indexOf('if (wasPrinted(job.id))')).toBeLessThan(run.indexOf('printTo('));
    // Remembered before the report, and the report is outside the catch.
    expect(run).toMatch(/return;\s*\}\s*\/\/[^\n]*\n[^\n]*\n\s*markPrinted\(job\.id\);\s*await source\.report\(job\.id, \{ result: 'printed' \}\);/);
  });
});

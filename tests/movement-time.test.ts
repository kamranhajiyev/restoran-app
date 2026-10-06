// Test Restoran, 2026-10-07: the till showed each mədaxil/məxaric with its
// time, admin showed only the reason and who. Both now print it with tzTime.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { tzTime } from '@/lib/business-day';

describe('kassa movement time', () => {
  it("reads the restaurant's clock, not UTC", () => {
    expect(tzTime('2026-10-06T17:11:00Z', 'Asia/Baku')).toBe('21:11');
    expect(tzTime('2026-10-06T20:05:00Z', 'Asia/Baku')).toBe('00:05');
  });

  it('admin and the till both show it with tzTime', () => {
    const admin = readFileSync('app/admin/page.tsx', 'utf8');
    const seller = readFileSync('app/seller/page.tsx', 'utf8');
    expect(admin).toContain('tzTime(m.at, bizSettings.timezone)');
    expect(seller).toContain('tzTime(m.at, bizSettings.timezone)');
  });
});

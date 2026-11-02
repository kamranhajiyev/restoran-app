import { describe, expect, it } from 'vitest';
import { dayHeading, groupByDay } from '@/lib/group-by-day';

describe('groupByDay', () => {
  it('puts a time-sorted list under one heading per day, keeping the order', () => {
    const rows = [
      { id: 'a', day: '2026-11-02' },
      { id: 'b', day: '2026-11-02' },
      { id: 'c', day: '2026-11-01' },
    ];
    const groups = groupByDay(rows, r => r.day);
    expect(groups.map(g => g.day)).toEqual(['2026-11-02', '2026-11-01']);
    expect(groups[0].items.map(r => r.id)).toEqual(['a', 'b']);
  });

  it('gives nothing for nothing', () => {
    expect(groupByDay([], () => '2026-11-02')).toEqual([]);
  });
});

describe('dayHeading', () => {
  it('says Bu gün for today and the date for any other day', () => {
    expect(dayHeading('2026-11-02', '2026-11-02')).toBe('Bu gün');
    expect(dayHeading('2026-11-01', '2026-11-02')).toBe('1 noyabr');
  });
});

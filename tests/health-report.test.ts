// 2026-10-08: the nightly health check only messaged Telegram, for two
// restaurants. Now every restaurant is checked at 05:00 Baku and each night is
// saved for the superadmin page, which only the superadmin may read or run.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { byCompany, problemLine } from '@/lib/health-report';

const sql = readFileSync('supabase/migrations/20261012_health_reports.sql', 'utf8');

describe('the nightly report', () => {
  it('runs every night at 05:00 Baku for every restaurant', () => {
    expect(sql).toMatch(/cron\.schedule\('nightly-health-report', '0 1 \* \* \*'/);
    expect(sql).toMatch(/public\.health_check\(null\)/);
  });

  it('is for the superadmin only', () => {
    expect(sql).toMatch(/health_reports enable row level security/);
    expect(sql).toMatch(/revoke all on public\.health_reports from anon, authenticated/);
    expect(sql).toMatch(/for select\s+to authenticated using \(is_superadmin\(\)\)/);
    expect(sql).toMatch(/if auth\.uid\(\) is not null and not public\.is_superadmin\(\) then/);
    expect(sql).toMatch(/revoke all on function public\.save_health_report\(\) from public, anon/);
  });

  it('names every problem the database can report in words', () => {
    const check = readFileSync('supabase/migrations/20261004_nightly_health_check.sql', 'utf8');
    const names = [...(check + sql).matchAll(/select c\.name, '([^']+)'/g)].map(m => m[1]);
    expect(names).toEqual(expect.arrayContaining([
      'stuck payment', 'unfinished write', 'open > 3h', 'no items',
      'shift open > 24h', 'tickets not printed', 'expires soon', 'no orders today',
    ]));
    for (const problem of names) {
      const line = problemLine({ company: 'X', problem, order_number: 5, at: '2026-10-08T00:00:00Z', count: 3 });
      expect(line, problem).not.toContain(problem);
    }
  });

  it('runs the restaurant checks in the report but not in the Telegram message', () => {
    expect(sql).toMatch(/from public\.health_check_restaurants\(\)/);
    expect(sql).toMatch(/revoke all on function public\.health_check_restaurants\(\) from public, anon, authenticated/);
    expect(readFileSync('supabase/migrations/20261004_nightly_health_check.sql', 'utf8')).not.toContain('health_check_restaurants');
  });

  it('lists each restaurant once, its orders oldest first', () => {
    const groups = byCompany([
      { company: 'Latte Art', problem: 'no items', order_number: 12, at: '2026-10-08T20:00:00Z' },
      { company: 'İXLAS', problem: 'stuck payment', order_number: 7, at: '2026-10-08T10:00:00Z' },
      { company: 'Latte Art', problem: 'open > 3h', order_number: 9, at: '2026-10-08T18:00:00Z' },
    ]);
    expect(groups.map(g => g.company)).toEqual(['İXLAS', 'Latte Art'].sort((a, b) => a.localeCompare(b)));
    const latte = groups.find(g => g.company === 'Latte Art')!;
    expect(latte.lines).toEqual(['№9 3 saatdan çoxdur açıqdır', '№12 içində məhsul yoxdur']);
  });
});

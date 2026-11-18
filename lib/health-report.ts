// The nightly health report on the superadmin page (20261012_health_reports.sql).
// The database finds the problems; this only turns a saved night into lines.

import { formatDate } from './dates';

export type HealthProblem = {
  company: string;
  problem: string;
  order_number: number | null;
  at: string;
  count?: number | null;
};

export type HealthReport = { id: number; runAt: string; problems: HealthProblem[] };

function bakuDate(iso: string): string {
  return formatDate(iso, 'Asia/Baku');
}

/** One problem in words, in Azerbaijani (the order ones say what Telegram says). */
export function problemLine(p: HealthProblem): string {
  const order = `№${p.order_number ?? '?'}`;
  switch (p.problem) {
    case 'stuck payment':       return `${order} ödənilə bilmir — Ödəniş düyməsi işləmir`;
    case 'unfinished write':    return `${order} tam yadda saxlanmayıb`;
    case 'no items':            return `${order} içində məhsul yoxdur`;
    case 'open > 3h':           return `${order} 3 saatdan çoxdur açıqdır`;
    case 'shift open > 24h':    return `Növbə 1 gündən çoxdur bağlanmayıb (açılıb: ${bakuDate(p.at)})`;
    case 'tickets not printed': return `${p.count ?? '?'} mətbəx çeki çap olunmayıb`;
    case 'expires soon':        return `Ödəniş müddəti bitir: ${bakuDate(p.at)}`;
    // count = whole hours since the last order (20261116); older nights have none.
    case 'no orders today':     return `Son ${p.count ?? 24} saatda sifariş yoxdur — kassa işləyirmi?`;
    default:                    return `${p.order_number ? order + ' ' : ''}${p.problem}`;
  }
}

/** Problems the report no longer shows (still in nights saved before 20261116). */
const HIDDEN = new Set(['open > 3h']);

/** A saved night's problems without the ones the report no longer shows. */
export function shownProblems(problems: HealthProblem[]): HealthProblem[] {
  return problems.filter(p => !HIDDEN.has(p.problem));
}

/** One block per restaurant, in name order, its problems oldest first. */
export function byCompany(problems: HealthProblem[]): { company: string; lines: string[] }[] {
  const groups = new Map<string, HealthProblem[]>();
  for (const p of problems) groups.set(p.company, [...(groups.get(p.company) ?? []), p]);
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([company, list]) => ({
      company,
      lines: [...list].sort((a, b) => a.at.localeCompare(b.at)).map(problemLine),
    }));
}

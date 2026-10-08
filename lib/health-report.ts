// The nightly health report on the superadmin page (20261012_health_reports.sql).
// The database finds the problems; this only turns a saved night into lines.

export type HealthProblem = {
  company: string;
  problem: string;
  order_number: number | null;
  at: string;
  count?: number | null;
};

export type HealthReport = { id: number; runAt: string; problems: HealthProblem[] };

function bakuDate(iso: string): string {
  return new Date(iso).toLocaleDateString('az-AZ', { timeZone: 'Asia/Baku', day: '2-digit', month: '2-digit', year: 'numeric' });
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
    case 'no orders today':     return 'Son 24 saatda sifariş yoxdur — kassa işləyirmi?';
    default:                    return `${p.order_number ? order + ' ' : ''}${p.problem}`;
  }
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

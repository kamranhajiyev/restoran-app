import { dayLabel } from './finance';

/** Runs of items that share a day, in the order given — a list sorted by time
 *  comes back as one group per day. `dayOf` returns 'YYYY-MM-DD'. */
export function groupByDay<T>(items: T[], dayOf: (item: T) => string): { day: string; items: T[] }[] {
  const out: { day: string; items: T[] }[] = [];
  for (const item of items) {
    const day = dayOf(item);
    const last = out[out.length - 1];
    if (last?.day === day) last.items.push(item); else out.push({ day, items: [item] });
  }
  return out;
}

/** The heading over a day's rows: "Bu gün" for today, the date otherwise. */
export function dayHeading(day: string, today: string): string {
  return day === today ? 'Bu gün' : dayLabel(day);
}

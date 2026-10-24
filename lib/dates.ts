// Every date the app shows or prints: day, then month, then year ("24.10.2026 13:15").
//
// Never 'az-AZ' through toLocaleString: Chrome and the exe carry no Azerbaijani
// date data, so they fall back to "2026-10-24 13:15" (Natiq, Test Restoran,
// 2026-10-24). The pieces come from formatToParts and are put in order here.

type When = string | number | Date;

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz?: string): Intl.DateTimeFormat {
  const key = tz ?? '';
  let f = fmtCache.get(key);
  if (!f) {
    const opts: Intl.DateTimeFormatOptions = {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    };
    try {
      f = new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: tz || undefined });
    } catch {
      // a timezone this engine does not know: the device's own clock
      f = new Intl.DateTimeFormat('en-GB', opts);
    }
    fmtCache.set(key, f);
  }
  return f;
}

const pad = (n: number) => String(n).padStart(2, '0');

function parts(at: When, tz?: string) {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  const p = fmt(tz).formatToParts(d);
  const get = (t: string) => Number(p.find(x => x.type === t)?.value ?? 0);
  // some engines format midnight as "24"
  return { y: get('year'), mo: pad(get('month')), d: pad(get('day')), h: pad(get('hour') % 24), mi: pad(get('minute')) };
}

/** "24.10.2026" */
export function formatDate(at: When, tz?: string): string {
  const p = parts(at, tz);
  return p ? `${p.d}.${p.mo}.${p.y}` : '';
}

/** "24.10.2026 13:15" */
export function formatDateTime(at: When, tz?: string): string {
  const p = parts(at, tz);
  return p ? `${p.d}.${p.mo}.${p.y} ${p.h}:${p.mi}` : '';
}

/** "24.10" */
export function formatDayMonth(at: When, tz?: string): string {
  const p = parts(at, tz);
  return p ? `${p.d}.${p.mo}` : '';
}

/** "24.10 13:15" */
export function formatDayMonthTime(at: When, tz?: string): string {
  const p = parts(at, tz);
  return p ? `${p.d}.${p.mo} ${p.h}:${p.mi}` : '';
}

/** "13:15" */
export function formatTime(at: When, tz?: string): string {
  const p = parts(at, tz);
  return p ? `${p.h}:${p.mi}` : '';
}

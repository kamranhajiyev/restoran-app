// Company-local time and "business day" helpers.
//
// All timestamps are stored in UTC. Statistics group orders by *business day*
// in the company's timezone (set by the superadmin): if a company works past
// midnight (e.g. 10:00–04:00), orders after midnight still belong to the
// previous day's numbers. The rollover point is derived from the working
// hours: when closing time is at or before opening time the schedule crosses
// midnight and the day rolls over at closing time; otherwise at midnight.

export const DEFAULT_TZ = 'Asia/Baku';

export interface CompanySettings {
  timezone: string;
  workOpen: string;  // 'HH:MM'
  workClose: string; // 'HH:MM'
}

export const DEFAULT_SETTINGS: CompanySettings = { timezone: DEFAULT_TZ, workOpen: '00:00', workClose: '00:00' };

function parseHM(s: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(s ?? '');
  if (!m) return 0;
  return Math.min(23, +m[1]) * 60 + Math.min(59, +m[2]);
}

export function cutoffMinutes(s: CompanySettings): number {
  const open = parseHM(s.workOpen), close = parseHM(s.workClose);
  return close <= open ? close : 0;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    const opts: Intl.DateTimeFormatOptions = {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    };
    try {
      f = new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: tz });
    } catch {
      f = new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: DEFAULT_TZ });
    }
    fmtCache.set(tz, f);
  }
  return f;
}

function tzParts(d: Date, tz: string) {
  const parts = fmt(tz).formatToParts(d);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0);
  // some engines format midnight as "24"
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute') };
}

const pad = (n: number) => String(n).padStart(2, '0');

// Calendar date in the given timezone, as 'YYYY-MM-DD'
export function tzDateStr(d: Date, tz: string): string {
  const p = tzParts(d, tz);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}

// Hour of day (0–23) in the given timezone
export function tzHour(iso: string, tz: string): number {
  return tzParts(new Date(iso), tz).h;
}

// Business day a timestamp belongs to: shift back by the cutoff, then take
// the calendar date in the company timezone.
export function businessDay(iso: string, s: CompanySettings): string {
  return tzDateStr(new Date(new Date(iso).getTime() - cutoffMinutes(s) * 60000), s.timezone);
}

export function businessToday(s: CompanySettings): string {
  return businessDay(new Date().toISOString(), s);
}

// UTC instant when the given business day begins (00:00 + cutoff, company time)
export function businessDayStartUtc(dayStr: string, s: CompanySettings): Date {
  const [y, mo, d] = dayStr.split('-').map(Number);
  // first guess: treat company wall time as UTC, then correct by the
  // timezone offset measured at that instant
  const guess = Date.UTC(y, mo - 1, d, 0, cutoffMinutes(s));
  const p = tzParts(new Date(guess), s.timezone);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
  return new Date(guess - (asUtc - guess));
}

// 'YYYY-MM-DD' string shifted by n days
export function addDays(dayStr: string, n: number): string {
  const [y, mo, d] = dayStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

// Whole days from b to a (a - b), both 'YYYY-MM-DD'
export function dayDiff(a: string, b: string): number {
  const p = (s: string) => { const [y, mo, d] = s.split('-').map(Number); return Date.UTC(y, mo - 1, d); };
  return Math.round((p(a) - p(b)) / 86400000);
}

// Weekday (0 = Sunday) of a 'YYYY-MM-DD' string
export function dayOfWeek(dayStr: string): number {
  const [y, mo, d] = dayStr.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

// Local-noon Date for a 'YYYY-MM-DD' string — safe for reading calendar
// fields (getDate/getMonth/getFullYear) regardless of device timezone.
export function dayToDate(dayStr: string): Date {
  const [y, mo, d] = dayStr.split('-').map(Number);
  return new Date(y, mo - 1, d, 12);
}

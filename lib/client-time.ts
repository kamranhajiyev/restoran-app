// When something happened, as the till saw it. A sale made offline at 23:50
// reached the server after midnight and was stamped with the server's clock, so
// it landed in the next shift or the next day. The till's time is used when it
// is believable; a missing, broken, future or very old one falls back to now.

const SKEW_MS = 5 * 60 * 1000;          // a till clock a little ahead
const MAX_AGE_MS = 7 * 24 * 3600 * 1000; // a queue older than a week is a broken clock

export function clientTime(sent: unknown, now: Date = new Date()): string {
  if (typeof sent !== 'string') return now.toISOString();
  const t = Date.parse(sent);
  if (Number.isNaN(t)) return now.toISOString();
  if (t > now.getTime() + SKEW_MS || t < now.getTime() - MAX_AGE_MS) return now.toISOString();
  return new Date(Math.min(t, now.getTime())).toISOString();
}

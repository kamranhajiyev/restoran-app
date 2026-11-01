// The database tests (`npm run test:db`) add, change and delete real rows, so
// they run on "restoran testing" only. Anything else, production above all, is
// refused before a single request goes out (AGENTS.md: never touch production).

export const TESTING_REF = 'bmqilobhdbipnpkyzomb';
export const LIVE_REF = 'laxeqbztathmxfbkkthb';

/** The reason the database tests must not run on this URL, or null when it is testing. */
export function notTestingReason(url: string | undefined): string | null {
  if (!url) return 'NEXT_PUBLIC_SUPABASE_URL is not set (.env.local)';
  if (url.includes(LIVE_REF)) return `${url} is PRODUCTION: the database tests never run there`;
  let host: string;
  try { host = new URL(url).hostname; } catch { return `${url} is not a URL`; }
  if (host !== `${TESTING_REF}.supabase.co`) return `${url} is not "restoran testing" (${TESTING_REF})`;
  return null;
}

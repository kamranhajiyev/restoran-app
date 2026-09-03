// Where a menu photograph is loaded from.
//
// In a browser, from Supabase storage, as it always has been. On the Windows
// till, from the machine — via the `/_img` handler on the app's own origin,
// which serves a cached copy and fetches one the first time (electron/images.ts).
//
// The remote URL stays the truth everywhere it is stored. Nothing rewrites a
// menu doc, because an order snapshots the item it was made from and that
// snapshot is replayed to Supabase — a local path baked into a doc would end up
// in Postgres and be wrong for every other device.

import { isDesktop } from "./desktopPrint";

/**
 * The src to actually put on an <img>.
 *
 * Passes anything that is not a remote picture straight through: a data: URI,
 * a relative asset in the bundle, an empty field.
 */
export function tillImage(url: string): string;
export function tillImage(url: string | undefined | null): string | undefined;
export function tillImage(url: string | undefined | null): string | undefined {
  if (!url) return url ?? undefined;
  if (!isDesktop() || !/^https?:\/\//i.test(url)) return url;
  return `/_img?src=${encodeURIComponent(url)}`;
}

/**
 * Ask the machine to pull a menu's photographs down now.
 *
 * Called at the end of a sync, while there is certainly a line. Without it the
 * cache only fills for the categories a waiter happened to open before the
 * outage, which is the same as no cache on the night it matters.
 *
 * Never throws and never blocks anything: pictures are the last thing to hold
 * up a till.
 */
export async function cacheImages(urls: (string | undefined | null)[]): Promise<number> {
  const till = typeof window === "undefined" ? null : window.posNative?.till;
  if (!till) return 0;

  const remote = urls.filter((u): u is string => Boolean(u) && /^https?:\/\//i.test(u!));
  if (remote.length === 0) return 0;

  try {
    const { cached } = await till.cacheImages([...new Set(remote)]);
    return cached;
  } catch {
    return 0;
  }
}

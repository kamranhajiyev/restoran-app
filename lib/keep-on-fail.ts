// A failed read is not an empty answer.
//
// Test Restoran, 2026-10-06: on any blip the till jumped back to Sifarişlər,
// turned into "Növbəni aç", lost the category the seller was on, or showed an
// empty menu — each read answered its failure with [] or null, and the screen
// believed it. These turn a failure into "unknown", so the screen keeps what it
// has.

/** A terminal route's JSON body, or null when the read failed — the routes
 *  answer their own failures with a 500 and an empty list, which parses fine. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function jsonOrNull(res: Promise<Response>): Promise<any | null> {
  try {
    const r = await res;
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/** A JSON list from a terminal route, or null when the read failed. */
export async function listOrNull<T>(res: Promise<Response>, key: string): Promise<T[] | null> {
  const d = await jsonOrNull(res);
  return Array.isArray(d?.[key]) ? (d[key] as T[]) : null;
}

/** The open shift from /api/public-shift: null when there is none, undefined
 *  when the read failed. The route answers its own failures with a 500 and
 *  `{ shift: null }`, which must not read as "closed". */
export async function shiftOrUnknown<T>(res: Promise<Response>): Promise<T | null | undefined> {
  try {
    const r = await res;
    if (!r.ok) return undefined;
    const d = await r.json();
    return d && 'shift' in d ? (d.shift as T | null) : undefined;
  } catch {
    return undefined;
  }
}

/** The category to show after the menu reloads: the seller's own while it
 *  still exists, otherwise the first. */
export function keepCategory(current: string, cats: string[]): string {
  return cats.includes(current) ? current : (cats[0] ?? current);
}

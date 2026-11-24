// A return whose answer never came (the internet dropped while it was being
// saved): it may be saved or not. Kept on this machine, through leaving
// Qaytarma and a reload, until the server has said which — a return started
// again with a new id could pay the customer twice (2026-11-24).

import type { SaleReturn } from './returns';

export interface PendingReturn { id: string; key: string; at: string; total: number; pay: 'cash' | 'card'; receipt: string | null; seller: string }

const storeKey = (companyId: string) => `restoran_pending_return:${companyId}`;

export function readPendingReturn(companyId: string): PendingReturn | null {
  try {
    const p = JSON.parse(localStorage.getItem(storeKey(companyId)) ?? 'null') as PendingReturn | null;
    return p && typeof p.id === 'string' && typeof p.at === 'string' ? p : null;
  } catch { return null; }
}

export function writePendingReturn(companyId: string, p: PendingReturn | null): void {
  try {
    if (p) localStorage.setItem(storeKey(companyId), JSON.stringify(p));
    else localStorage.removeItem(storeKey(companyId));
  } catch { /* storage blocked: as before, the id on the screen still guards a second press */ }
}

const DAY = 24 * 60 * 60_000;
/** Where to look for it: a day each way, so a till's wrong clock still finds it. */
export function pendingWindow(p: PendingReturn, now = Date.now()): { from: string; to: string } {
  return { from: new Date(Date.parse(p.at) - DAY).toISOString(), to: new Date(Math.max(now, Date.parse(p.at)) + DAY).toISOString() };
}

/** What became of it, from the returns in that window; null = not read. */
export function pendingOutcome(p: PendingReturn, returns: Pick<SaleReturn, 'id' | 'total'>[] | null): { state: 'unknown' } | { state: 'saved'; total: number } | { state: 'not_saved' } {
  if (!returns) return { state: 'unknown' };
  const saved = returns.find(r => r.id === p.id);
  return saved ? { state: 'saved', total: saved.total } : { state: 'not_saved' };
}

/** Pressing Qaytar again without leaving is the same return: it goes with the
 *  same id and the server saves it once. Anything else asks first. */
export function mustAskFirst(p: PendingReturn | null, onScreen: { key: string; id: string } | null, key: string): boolean {
  return !!p && !(onScreen?.id === p.id && onScreen.key === key);
}

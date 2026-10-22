// What a till remembers of the other tills on the restaurant's Wi-Fi: the
// highest order number any of them said it gave out. The talking itself is the
// machine's job (electron/till-peers.ts on the exe); this is the part the
// order numbering in write.ts reads, kept beside it so both apps share it.

import { db, getMeta, setMeta } from './db';

export interface PeerNews {
  companyId: string;
  /** The highest order number the sender has given out. */
  max: number;
  till: number;
}

const heardKey = (companyId: string) => `peer_order_max:${companyId}`;

/** The highest number another till has said it gave out. */
export function heardMax(companyId: string): number {
  return Number(getMeta(db(), heardKey(companyId)) ?? 0) || 0;
}

/** Remember a number heard from another till. Only ever moves up. */
export function hear(news: PeerNews): void {
  if (news.max > heardMax(news.companyId)) setMeta(db(), heardKey(news.companyId), String(news.max));
}

let announcer: () => void = () => {};

/** How this machine tells the others; nothing until it has a way to. */
export function setAnnouncer(fn: () => void): void {
  announcer = fn;
}

/** Tell the other tills this machine's highest number. Safe to call any time. */
export function announce(): void {
  announcer();
}

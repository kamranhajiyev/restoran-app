// Tills in one restaurant tell each other, over the restaurant's Wi-Fi, the
// highest order number they have handed out.
//
// Each machine numbers its own orders from its own database (till-write.ts),
// and that database only hears about the other till's orders on the next pull
// from the server — every five minutes, or never while the internet is down. So
// two tills picked the same number, and the second one was renumbered by the
// server after its paper had already been printed. Poster's tills solve this by
// talking on the local network; these do the same, in the smallest way that
// works: no till is in charge, each one broadcasts "my highest is N" and takes
// the highest it has heard into account. Switching any till off breaks nothing.
//
// If the Wi-Fi keeps machines apart (guest networks often do), nothing is heard
// and the till numbers as before; app/api/add-order still renumbers a clash, so
// no sale is lost either way.
//
// Messages are signed with the till link, so someone else on the Wi-Fi cannot
// push a restaurant's numbers forward. The link itself never leaves the machine.

import { createHmac, timingSafeEqual } from 'node:crypto';
import dgram from 'node:dgram';
import { db, getMeta, setMeta } from './db';

export const PEER_PORT = 47845;
const EVERY_MS = 10_000;
const heardKey = (companyId: string) => `peer_order_max:${companyId}`;

export interface PeerNews {
  companyId: string;
  /** The highest order number the sender has given out. */
  max: number;
  till: number;
}

function sign(token: string, news: PeerNews): string {
  return createHmac('sha256', token).update(`${news.companyId}|${news.max}|${news.till}`).digest('hex');
}

export function encodeNews(token: string, news: PeerNews): Buffer {
  return Buffer.from(JSON.stringify({ v: 1, c: news.companyId, n: news.max, t: news.till, s: sign(token, news) }));
}

/** The news in a message, or null if it is not from a till of this company. */
export function decodeNews(token: string, companyId: string, msg: Buffer): PeerNews | null {
  try {
    const m = JSON.parse(msg.toString('utf8')) as { v?: unknown; c?: unknown; n?: unknown; t?: unknown; s?: unknown };
    if (m.v !== 1 || m.c !== companyId || typeof m.s !== 'string') return null;
    const max = Number(m.n);
    const till = Number(m.t);
    if (!Number.isSafeInteger(max) || max < 0 || !Number.isSafeInteger(till)) return null;
    const news = { companyId, max, till };
    const want = Buffer.from(sign(token, news), 'hex');
    const got = Buffer.from(m.s, 'hex');
    return got.length === want.length && timingSafeEqual(got, want) ? news : null;
  } catch {
    return null;
  }
}

/** The highest number another till has said it gave out. */
export function heardMax(companyId: string): number {
  return Number(getMeta(db(), heardKey(companyId)) ?? 0) || 0;
}

/** Remember a number heard from another till. Only ever moves up. */
export function hear(news: PeerNews): void {
  if (news.max > heardMax(news.companyId)) setMeta(db(), heardKey(news.companyId), String(news.max));
}

interface Link { token: string; companyId: string; tillNumber: number }

function readLink(): Link | null {
  try {
    const raw = getMeta(db(), 'terminal_link');
    if (!raw) return null;
    const l = JSON.parse(raw) as Partial<Link>;
    return l.token && l.companyId ? { token: l.token, companyId: l.companyId, tillNumber: Number(l.tillNumber) || 1 } : null;
  } catch {
    return null;
  }
}

let socket: dgram.Socket | null = null;
let ownMax: (companyId: string) => number = () => 0;

/** Tell the other tills this machine's highest number. Safe to call any time. */
export function announce(): void {
  const link = readLink();
  if (!socket || !link) return;
  const max = Math.max(ownMax(link.companyId), heardMax(link.companyId));
  const msg = encodeNews(link.token, { companyId: link.companyId, max, till: link.tillNumber });
  socket.send(msg, PEER_PORT, '255.255.255.255', () => {});
}

/**
 * Start listening and announcing. `highest` is this machine's own highest
 * order number for a company. Any failure (port taken, no network) leaves the
 * till numbering on its own, as it did before this existed.
 */
export function startTillPeers(highest: (companyId: string) => number): void {
  if (socket) return;
  ownMax = highest;
  try {
    const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    s.on('error', err => console.warn('[peers]', err.message));
    s.on('message', msg => {
      const link = readLink();
      if (!link) return;
      const news = decodeNews(link.token, link.companyId, msg);
      if (news) hear(news);
    });
    s.bind(PEER_PORT, () => {
      s.setBroadcast(true);
      announce();
    });
    setInterval(announce, EVERY_MS).unref();
    socket = s;
  } catch (e) {
    console.warn('[peers] off:', e instanceof Error ? e.message : e);
  }
}

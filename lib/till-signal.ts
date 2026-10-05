// "Something new" from the database, so the tills stop asking on a timer.
//
// The exe asked every 4 s for kitchen tickets, every 10 s for readiness, every
// 20 s for new orders: ~34,000 requests a day per till, nearly every answer
// "nothing". The database now broadcasts the kind of change on 'till:<company>'
// (supabase/migrations/20261005_till_signal.sql) and the tills fetch only then.
//
// Their timers stay, slowed down, because a socket can die quietly on bad wifi
// or a sleeping laptop. While the socket is down they run at their old speed.

import { supabase } from './supabase';

export type TillSignal = 'print' | 'orders' | 'ready' | 'shift' | 'menu';

type Listener = (kind: TillSignal) => void;
type StatusListener = (up: boolean) => void;

// One socket per restaurant, shared by everyone listening — the print loop and
// the seller screen both want it, and two channels on one topic is two sockets'
// worth of messages for nothing.
let topic: string | null = null;
let channel: ReturnType<typeof supabase.channel> | null = null;
let up = false;
const listeners = new Set<Listener>();
const statusListeners = new Set<StatusListener>();

// A new order is three messages (the order, its dishes, its tickets) inside the
// same instant. One fetch answers all three.
const DEBOUNCE_MS = 300;
const pending = new Map<TillSignal, ReturnType<typeof setTimeout>>();

function deliver(kind: TillSignal) {
  if (pending.has(kind)) return;
  pending.set(kind, setTimeout(() => {
    pending.delete(kind);
    for (const l of listeners) l(kind);
  }, DEBOUNCE_MS));
}

function setUp(next: boolean) {
  if (up === next) return;
  up = next;
  for (const l of statusListeners) l(up);
}

function open(companyId: string) {
  const name = `till:${companyId}`;
  if (topic === name && channel) return;
  close();
  topic = name;
  channel = supabase
    .channel(name)
    .on('broadcast', { event: '*' }, m => deliver(m.event as TillSignal))
    .subscribe(status => {
      setUp(status === 'SUBSCRIBED');
      // supabase-js retries a channel that errored or timed out on its own;
      // CLOSED is the one it gives up on, so start a fresh one a little later.
      if (status === 'CLOSED' && listeners.size > 0 && topic === name) {
        setTimeout(() => { if (topic === name && listeners.size > 0) { channel = null; open(companyId); } }, 5_000);
      }
    });
}

function close() {
  if (channel) void supabase.removeChannel(channel);
  channel = null;
  topic = null;
  setUp(false);
}

/** Listen for this restaurant's signals. Returns the teardown. */
export function listenTill(companyId: string, onSignal: Listener): () => void {
  listeners.add(onSignal);
  open(companyId);
  return () => {
    listeners.delete(onSignal);
    if (listeners.size === 0) close();
  };
}

/** Told whenever the socket comes up or goes down; called once straight away. */
export function onTillSignalStatus(l: StatusListener): () => void {
  statusListeners.add(l);
  l(up);
  return () => { statusListeners.delete(l); };
}

export function tillSignalUp(): boolean {
  return up;
}

/**
 * Whether a timer tick should still go to the server. With the socket up the
 * signal brings the news and the timer is only a safety net, so it runs at
 * `slowMs`; with it down the timer is the only way news arrives, so every tick
 * goes, exactly as before.
 */
export function timerDue(lastRun: number, now: number, signalUp: boolean, slowMs: number): boolean {
  return !signalUp || now - lastRun >= slowMs;
}

/** How long the safety-net timers wait while the signal is up. */
export const SAFETY_NET_MS = 60_000;

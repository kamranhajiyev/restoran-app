// The restaurant's "something new" signal, and the timers it slows down.
//
// The exe asked the site every 4 s for tickets, every 10 s for readiness and
// every 20 s for new orders — ~34,000 requests a day per till. With the signal
// up those become a once-a-minute safety net; with it down they run as before.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (m: { event: string }) => void;
let onBroadcast: Handler | null = null;
let onStatus: ((s: string) => void) | null = null;
const channels: string[] = [];

vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: (name: string) => {
      channels.push(name);
      const ch = {
        on: (_t: string, _f: unknown, h: Handler) => { onBroadcast = h; return ch; },
        subscribe: (cb: (s: string) => void) => { onStatus = cb; return ch; },
      };
      return ch;
    },
    removeChannel: async () => {},
  },
}));

let sig: typeof import('@/lib/till-signal');

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  channels.length = 0;
  sig = await import('@/lib/till-signal');
});
afterEach(() => vi.useRealTimers());

describe('timerDue', () => {
  it('runs every tick while the signal is down', () => {
    expect(sig.timerDue(1000, 1001, false, 60_000)).toBe(true);
  });
  it('runs only once a minute while the signal is up', () => {
    expect(sig.timerDue(0, 30_000, true, 60_000)).toBe(false);
    expect(sig.timerDue(0, 60_000, true, 60_000)).toBe(true);
  });
});

describe('listenTill', () => {
  it("joins one topic per restaurant, shared by every listener", () => {
    const a = vi.fn(); const b = vi.fn();
    sig.listenTill('c1', a);
    sig.listenTill('c1', b);
    expect(channels).toEqual(['till:c1']);
    onBroadcast!({ event: 'print' });
    vi.advanceTimersByTime(400);
    expect(a).toHaveBeenCalledWith('print');
    expect(b).toHaveBeenCalledWith('print');
  });

  it('turns the burst a new order makes into one call per kind', () => {
    const l = vi.fn();
    sig.listenTill('c1', l);
    onBroadcast!({ event: 'orders' });
    onBroadcast!({ event: 'orders' });
    onBroadcast!({ event: 'print' });
    vi.advanceTimersByTime(400);
    expect(l.mock.calls.map(c => c[0]).sort()).toEqual(['orders', 'print']);
  });

  it('reports the socket up and down, so the timers know which speed to run at', () => {
    sig.listenTill('c1', () => {});
    expect(sig.tillSignalUp()).toBe(false);
    onStatus!('SUBSCRIBED');
    expect(sig.tillSignalUp()).toBe(true);
    onStatus!('CHANNEL_ERROR');
    expect(sig.tillSignalUp()).toBe(false);
  });

  it('opens a fresh channel after the old one is closed for good', () => {
    sig.listenTill('c1', () => {});
    onStatus!('CLOSED');
    vi.advanceTimersByTime(5_000);
    expect(channels).toEqual(['till:c1', 'till:c1']);
  });
});

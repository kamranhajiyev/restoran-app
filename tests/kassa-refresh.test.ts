// Admin's Kassa tab re-downloaded the open shift every 30 s whether anything
// changed or not — the biggest share of egress. With realtime up the timer is
// a 5-minute safety net; a hidden tab never polls.

import { describe, expect, it } from 'vitest';
import { KASSA_GATHER_MS, KASSA_SAFETY_NET_MS, KASSA_TICK_MS, kassaTickDue } from '@/lib/kassa-refresh';

const t0 = 1_000_000;

describe('kassaTickDue', () => {
  it('does not re-download every tick while realtime is up', () => {
    expect(kassaTickDue({ lastRun: t0, now: t0 + KASSA_TICK_MS, realtimeUp: true, visible: true })).toBe(false);
    expect(kassaTickDue({ lastRun: t0, now: t0 + KASSA_SAFETY_NET_MS - 1, realtimeUp: true, visible: true })).toBe(false);
  });

  it('still runs the safety net while realtime is up', () => {
    expect(kassaTickDue({ lastRun: t0, now: t0 + KASSA_SAFETY_NET_MS, realtimeUp: true, visible: true })).toBe(true);
  });

  it('polls every tick when realtime is down, so totals do not freeze', () => {
    expect(kassaTickDue({ lastRun: t0, now: t0 + KASSA_TICK_MS, realtimeUp: false, visible: true })).toBe(true);
  });

  it('never polls a hidden tab', () => {
    expect(kassaTickDue({ lastRun: t0, now: t0 + 60 * 60_000, realtimeUp: false, visible: false })).toBe(false);
  });
});

describe('KASSA_GATHER_MS', () => {
  it('a rush never re-downloads the shift more often than the old 30 s timer', () => {
    expect(KASSA_GATHER_MS).toBeGreaterThanOrEqual(30_000);
  });
});

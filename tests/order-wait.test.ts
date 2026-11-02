// A table waiting long turns its time orange, then red, so it is not
// forgotten on a long list of open orders.

import { describe, expect, it } from 'vitest';
import { waitLevel } from '@/components/seller/order-format';

const now = Date.parse('2026-11-02T12:00:00Z');
const ago = (mins: number) => new Date(now - mins * 60000).toISOString();

describe('waiting time colour', () => {
  it('stays plain under 15 minutes', () => {
    expect(waitLevel(ago(14), now)).toBe('ok');
  });
  it('turns orange at 15 minutes', () => {
    expect(waitLevel(ago(15), now)).toBe('late');
    expect(waitLevel(ago(29), now)).toBe('late');
  });
  it('turns red at 30 minutes', () => {
    expect(waitLevel(ago(30), now)).toBe('very-late');
    expect(waitLevel(ago(300), now)).toBe('very-late');
  });
});

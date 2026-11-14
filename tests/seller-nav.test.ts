// "Yeni sifariş" moved to the top of the seller's menu and became the screen
// the till opens on (2026-11-14). The side menu and the phone's bottom bar
// each kept their own list before, so one could be changed without the other.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OPENING_TAB, TAB_LABELS, sellerTabs } from '@/lib/seller-nav';

const page = readFileSync('app/seller/page.tsx', 'utf8');

describe('seller tabs', () => {
  it('put Yeni sifariş first, then Sifarişlər', () => {
    const tabs = sellerTabs({ kassaShown: true, couriersShown: true });
    expect(tabs).toEqual(['new-order', 'orders', 'kassa', 'couriers', 'history']);
    expect(TAB_LABELS[tabs[0]]).toBe('Yeni sifariş');
  });

  it('leave out Kassa and Kuryerlər where they are off', () => {
    expect(sellerTabs({ kassaShown: false, couriersShown: false })).toEqual(['new-order', 'orders', 'history']);
  });

  it('open the till on Yeni sifariş', () => {
    expect(OPENING_TAB).toBe('new-order');
    expect(page).toContain('useState<View>(OPENING_TAB)');
  });

  it('are one list for the side menu and the bottom bar', () => {
    expect(page.match(/navTabs\.map\(/g)?.length).toBe(2);
    expect(page).not.toMatch(/label: 'Sifarişlər'/);
  });
});

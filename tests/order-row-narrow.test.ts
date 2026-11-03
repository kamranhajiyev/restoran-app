// On a 1024px till with the side menu open, the fixed columns of the order
// table took all the width: "Sifariş" (table name and dishes) shrank to nothing
// and its heading printed over "Durum" (customer screen, 2026-11-03).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ORDER_GRID } from '@/components/seller/OrderRow';

// Width of the grid's columns on a 1024px screen: minus the open side menu
// (w-56), the card's margins (mx-6) and its border.
const ROW_WIDTH = 1024 - 224 - 48 - 2;

function px(cls: string) {
  return Number(cls.match(/(\d+)/)![1]) * (cls.includes('px') ? 1 : 4);
}

describe('the order table on a narrow screen', () => {
  it('leaves "Sifariş" at least 200px below xl', () => {
    const classes = ORDER_GRID.split(' ').filter(c => !c.includes(':'));
    const cols = classes.find(c => c.startsWith('grid-cols-['))!.slice(11, -1).split('_');
    const fixed = cols.filter(c => /^\d+px$/.test(c)).reduce((s, c) => s + px(c), 0);
    const gap = px(classes.find(c => c.startsWith('gap-'))!) * (cols.length - 1);
    const pad = px(classes.find(c => c.startsWith('px-'))!) * 2;
    expect(ROW_WIDTH - fixed - gap - pad).toBeGreaterThanOrEqual(200);
  });

  it('header and rows use the same column rule', () => {
    const page = readFileSync('app/seller/page.tsx', 'utf8');
    const row = readFileSync('components/seller/OrderRow.tsx', 'utf8');
    expect(page).toMatch(/\$\{ORDER_GRID\} py-2\.5/);
    expect(row).toMatch(/\$\{ORDER_GRID\} py-4/);
    expect(page + row).not.toMatch(/(?<!xl:)grid-cols-\[90px/);
  });

  // Between md and lg the side menu and the bottom menu both showed: the same
  // menu twice (2026-11-03).
  it('shows the side menu or the bottom menu, never both', () => {
    const page = readFileSync('app/seller/page.tsx', 'utf8');
    expect(page).toMatch(/<aside className={`hidden md:block/);
    expect(page).toMatch(/<nav className="md:hidden fixed bottom-0/);
    expect(page).toContain('pb-16 md:pb-0');
  });
});

// The "⋯" menu on an order row was drawn inside the order list's card, which
// cuts off what sticks out (rounded corners need overflow: hidden), so the menu
// opened cut in half. It is fixed to the window now, so no box can cut it.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('the order row "⋯" menu', () => {
  it('is fixed to the window, not placed inside the row', () => {
    const src = readFileSync('components/seller/OrderRow.tsx', 'utf8');
    expect(src).toMatch(/style=\{menuAt\} className="fixed /);
    expect(src).not.toMatch(/absolute right-0 top-full[^"]*w-52/);
  });
});

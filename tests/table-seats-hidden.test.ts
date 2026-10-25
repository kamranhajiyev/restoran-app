// 2026-10-25, Natiq: a table's seat count is not needed, its name or number is
// enough. Admin no longer asks for it and no screen shows it; the column stays
// in the database (new tables get 4) so old restaurants lose nothing.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const screens = ['app/admin/page.tsx', 'app/seller/page.tsx', 'lib/features.ts'];

describe('table seats', () => {
  it.each(screens)('%s does not ask for or show how many people a table seats', file => {
    const src = readFileSync(file, 'utf8');
    expect(src).not.toMatch(/nəfər/);
    expect(src).not.toMatch(/Tutum/);
  });
});

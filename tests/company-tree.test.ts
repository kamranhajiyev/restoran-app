// Superadmin's list shows each branch right under its main məkan, and a branch
// whose main məkan is gone still shows.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { withBranches } from '@/lib/company-tree';

const c = (id: string, parentId: string | null = null) => ({ id, parentId });

describe('company list with branches', () => {
  it('puts each branch under its main məkan, in order', () => {
    const list = [c('test'), c('a1', 'kamran'), c('odessa'), c('kamran'), c('a2', 'kamran')];
    expect(withBranches(list).map(r => `${r.branch ? '  ' : ''}${r.company.id}`))
      .toEqual(['test', 'odessa', 'kamran', '  a1', '  a2']);
  });

  it('a branch whose main məkan is not listed stands on its own', () => {
    expect(withBranches([c('a1', 'trashed'), c('x')])).toEqual([
      { company: c('a1', 'trashed'), branch: false },
      { company: c('x'), branch: false },
    ]);
  });

  it('superadmin renders through it', () => {
    expect(readFileSync('app/superadmin/page.tsx', 'utf8')).toMatch(/withBranches\(companies\)\.map/);
  });
});

// "Kopyala" put the copy at the end of the menu, far from the item it was
// copied from (Test Restoran, 2026-10-05). It now goes right under it.

import { describe, expect, it } from 'vitest';
import { insertCopyAfter } from '@/lib/menu-copy';

const menu = [
  { id: 'a', name: 'Fanta 330 ml', category: 'İçkilər' },
  { id: 'b', name: 'Ayran 200ml', category: 'İçkilər' },
  { id: 'c', name: 'Cappy', category: 'İçkilər' },
];

describe('copying a menu item', () => {
  it('puts the copy right under the original', () => {
    const out = insertCopyAfter(menu, 'a', 'new');
    expect(out.map(m => m.id)).toEqual(['a', 'new', 'b', 'c']);
    expect(out[1]).toEqual({ id: 'new', name: 'Fanta 330 ml (kopya)', category: 'İçkilər' });
  });

  it('puts a copy of the last item at the end', () => {
    expect(insertCopyAfter(menu, 'c', 'new').map(m => m.id)).toEqual(['a', 'b', 'c', 'new']);
  });

  it('leaves the menu alone for an unknown id', () => {
    expect(insertCopyAfter(menu, 'x', 'new')).toBe(menu);
  });
});

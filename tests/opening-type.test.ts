// "Yeni sifariş" showed big tiles first and then, once Masa was picked, the
// same types again as a small row — two looks for one choice. It now opens on
// Masa with the table map showing; the tiles only ask when there is no Masa.

import { describe, expect, it } from 'vitest';
import { DEFAULT_ORDER_TYPES, openingType } from '@/lib/order-types';

describe('the type "Yeni sifariş" opens on', () => {
  it('is Masa when the till has tables', () => {
    expect(openingType(DEFAULT_ORDER_TYPES, true)?.id).toBe('masa');
  });

  it('is none when Masa is turned off', () => {
    const noMasa = DEFAULT_ORDER_TYPES.filter(t => t.builtIn !== 'masa');
    expect(openingType(noMasa, true)).toBeNull();
  });

  it('is never a type the owner added, even one that asks for a table', () => {
    const custom = { ...DEFAULT_ORDER_TYPES[0], id: 'xarici', name: 'Xarici', builtIn: undefined };
    expect(openingType([custom], true)).toBeNull();
  });
});

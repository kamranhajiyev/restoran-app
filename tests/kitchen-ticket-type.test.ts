// Kitchen tickets: heavy bold at small sizes ran together on a real printer
// (Natiq, 2026-11-23). Larger and lighter, with only the word ŞƏRH in bold.
import { describe, expect, it } from 'vitest';
import { KITCHEN_ITEM, KITCHEN_MOD, noteSegments } from '@/lib/paper';

describe('kitchen ticket type', () => {
  it('is larger than before (dish 32, part/note 23)', () => {
    expect(KITCHEN_ITEM).toBeGreaterThan(32);
    expect(KITCHEN_MOD).toBeGreaterThan(23);
  });

  it('puts only the word ŞƏRH: in bold', () => {
    expect(noteSegments('kotlet ilə · ŞƏRH: AZ DUZLU')).toEqual([
      { text: 'kotlet ilə · ', bold: false },
      { text: 'ŞƏRH:', bold: true },
      { text: ' AZ DUZLU', bold: false },
    ]);
    expect(noteSegments('ŞƏRH: ACILI')).toEqual([{ text: 'ŞƏRH:', bold: true }, { text: ' ACILI', bold: false }]);
  });

  it('leaves a part or a wrapped row without the word all normal', () => {
    expect(noteSegments('2x Dolma')).toEqual([{ text: '2x Dolma', bold: false }]);
    expect(noteSegments('SOĞANSIZ')).toEqual([{ text: 'SOĞANSIZ', bold: false }]);
  });
});

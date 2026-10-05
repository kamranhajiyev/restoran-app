// The ticket put Tel and Ünvan first, but every screen still showed an online
// order's note as one line, "Qeyd: Tel: … · Ünvan: … · …" (Latte Art,
// 2026-10-05). The ticket and the screens now share noteLines.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { noteRows } from '@/lib/escpos';
import { noteLines } from '@/lib/order-note';

const online = 'Tel: 0709771070 · Ünvan: Gəncə Mall-un arxası, ev 271 · Qapını döymə';

describe('an order note', () => {
  it('puts the phone and address first, then the guest note', () => {
    expect(noteLines(online)).toEqual([
      'Tel: 0709771070',
      'Ünvan: Gəncə Mall-un arxası, ev 271',
      'Qeyd: Qapını döymə',
    ]);
  });

  it('is a plain Qeyd when the till typed it', () => {
    expect(noteLines('Soğansız')).toEqual(['Qeyd: Soğansız']);
  });

  it('reads the same on the ticket as on the screen', () => {
    expect(noteRows(online, 200)).toEqual(noteLines(online));
  });

  it('is never shown raw on a screen again', () => {
    for (const f of ['app/seller/page.tsx', 'app/admin/page.tsx', 'app/station/page.tsx', 'components/seller/OrderRow.tsx']) {
      const src = readFileSync(join(__dirname, '..', f), 'utf8');
      expect(src, f).not.toMatch(/Qeyd: \{order\.note\}|>\{order\.note\}</);
    }
  });
});

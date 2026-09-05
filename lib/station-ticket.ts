// A station ticket drawn as pixels, for the desktop shell.
//
// buildStationTicket() in escpos.ts sends characters and asks the printer to
// map them through CP857. The XP-Q806K ignores the codepage it advertises and
// stays on CP437, so "MASA DƏYİŞDİ" came out "MASA DEYÿŘDÿ" and "Sifariş" as
// "Sifarif" — the cook reads a dish name that isn't a word. Receipts already
// dodge this by rasterising; a kitchen ticket has the same letters and deserves
// the same treatment.
//
// Kept apart from escpos.ts because rasterize() needs a canvas: the standalone
// agent/ runs in Node with no DOM and keeps using the character path. Both
// build the same layout, so a change to one belongs in the other.

import { ESC, WIDTH, stringToBytes, type TicketPayload } from './escpos';
import { rasterize, type Line } from './raster';

const HEADING: Record<TicketPayload['kind'], string> = {
  new:    'YENİ SİFARİŞ',
  append: 'ƏLAVƏ',
  cancel: 'LƏĞV',
  move:   'MASA DƏYİŞDİ',
};

const tableLabel = (t: number | null | undefined) => (t ? String(t) : 'Takeaway');

export function buildStationTicketRaster(p: TicketPayload): Uint8Array {
  const when = new Date(p.at).toLocaleString('az-AZ', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  const lines: Line[] = [{ text: p.station, big: true, center: true }];

  // A cancellation must be unmistakable at a glance across a hot kitchen.
  if (p.kind === 'cancel' || p.kind === 'move') {
    lines.push({ text: `*** ${HEADING[p.kind]} ***`, big: true, center: true });
  } else {
    lines.push({ text: HEADING[p.kind], center: true });
  }

  lines.push(
    { text: '-'.repeat(WIDTH), center: true },
    { text: `Sifariş #${p.orderNumber ?? '-'}` },
  );

  // The old table is the whole point of a move slip: the ticket already at this
  // station names it, and that's the one being corrected.
  lines.push(
    p.kind === 'move'
      ? { text: `Masa: ${tableLabel(p.fromTable)} -> ${tableLabel(p.table)}` }
      // A courier order has no table, and "Takeaway" would send the food to the
      // counter instead of to the rider waiting for it.
      : p.courier
      ? { text: `KURYER: ${p.courier}` }
      : { text: `Masa: ${tableLabel(p.table)}` },
  );

  lines.push({ text: when });
  if (p.waiter) lines.push({ text: `Ofisiant: ${p.waiter}` });
  lines.push({ text: '='.repeat(WIDTH) });

  for (const item of p.items) {
    // Quantity first and doubled in size: from arm's length that's the only
    // number a cook needs to read correctly.
    const qty = `${item.qty}x`.padEnd(4);
    lines.push({ text: `${qty}${item.name.substring(0, WIDTH - 5)}`, big: true });
    if (item.modifiers) lines.push({ text: `    ${item.modifiers}` });
  }

  lines.push({ text: '='.repeat(WIDTH) });
  if (p.note) lines.push({ text: `Qeyd: ${p.note}` });

  const head = new Uint8Array(stringToBytes(ESC.INIT + ESC.LEFT));
  const image = rasterize(lines, WIDTH);
  const tail = new Uint8Array(stringToBytes('\n\n\n' + ESC.CUT));
  const out = new Uint8Array(head.length + image.length + tail.length);
  out.set(head, 0);
  out.set(image, head.length);
  out.set(tail, head.length + image.length);
  return out;
}

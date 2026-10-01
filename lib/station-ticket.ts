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

import { ESC, WIDTH, itemRows, stringToBytes, wrap, type TicketPayload } from './escpos';
import { rasterize, type Line } from './raster';

// Dish names a step up from `big`, wider as well as taller, so the cook can read
// them at arm's length. Wrapped to fewer columns to make room.
const ITEM_SCALE: [number, number] = [1.2, 1.8];
const ITEM_COLS = Math.floor(WIDTH / ITEM_SCALE[0]);

// A note slip has nothing on it to match against the ticket already on the rail
// except the order number, so that is what has to be readable from across the
// kitchen.
const NOTE_NUMBER_SCALE: [number, number] = [2, 2.5];

const HEADING: Record<TicketPayload['kind'], string> = {
  new:    'YENİ SİFARİŞ',
  append: 'ƏLAVƏ',
  cancel: 'LƏĞV',
  move:   'MASA DƏYİŞDİ',
  note:   'QEYD',
};

/**
 * `tableName` turns the table id the payload carries into what the room calls
 * it. The id is only a row number — a restaurant that remade its tables has
 * "Masa 1" at id 51, and a ticket that said 51 sent the cook nowhere.
 */
export function buildStationTicketRaster(p: TicketPayload, tableName?: (id: number) => string): Uint8Array {
  const place = (t: number | null | undefined) =>
    !t ? 'Takeaway' : tableName ? tableName(t) : `Masa ${t}`;

  const when = new Date(p.at).toLocaleString('az-AZ', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  const lines: Line[] = [{ text: p.station, big: true, center: true }];

  // A cancellation must be unmistakable at a glance across a hot kitchen.
  if (p.kind === 'cancel' || p.kind === 'move' || p.kind === 'note') {
    lines.push({ text: `*** ${HEADING[p.kind]} ***`, big: true, center: true });
  } else {
    lines.push({ text: HEADING[p.kind], center: true });
  }

  const number = `Sifariş #${p.orderNumber ?? '-'}`;
  lines.push(
    { text: '-'.repeat(WIDTH), center: true },
    p.kind === 'note' ? { text: number, scale: NOTE_NUMBER_SCALE } : { text: number },
  );

  // The old table is the whole point of a move slip: the ticket already at this
  // station names it, and that's the one being corrected.
  lines.push(
    p.kind === 'move'
      ? { text: `${place(p.fromTable)} -> ${place(p.table)}` }
      // A courier order has no table, and "Takeaway" would send the food to the
      // counter instead of to the rider waiting for it.
      : p.courier
      ? { text: `KURYER: ${p.courier}` }
      : { text: place(p.table) },
  );

  lines.push({ text: when });
  if (p.waiter) lines.push({ text: `Ofisiant: ${p.waiter}` });
  lines.push({ text: '='.repeat(WIDTH) });

  // A note slip has no items: the note is the whole message, so it takes their
  // place, in the same large type.
  if (p.kind === 'note') {
    for (const row of wrap(p.note ?? '', WIDTH)) lines.push({ text: row, big: true });
  }

  for (const item of p.items) {
    // Quantity first and doubled in size: from arm's length that's the only
    // number a cook needs to read correctly.
    for (const row of itemRows(`${item.qty}x`, item.name, ITEM_COLS)) {
      lines.push({ text: row, scale: ITEM_SCALE });
    }
    if (item.modifiers) lines.push({ text: `    ${item.modifiers}` });
  }

  lines.push({ text: '='.repeat(WIDTH) });
  if (p.note && p.kind !== 'note') lines.push({ text: `Qeyd: ${p.note}` });

  const head = new Uint8Array(stringToBytes(ESC.INIT + ESC.LEFT));
  const image = rasterize(lines, WIDTH);
  const tail = new Uint8Array(stringToBytes('\n\n\n' + ESC.CUT));
  const out = new Uint8Array(head.length + image.length + tail.length);
  out.set(head, 0);
  out.set(image, head.length);
  out.set(tail, head.length + image.length);
  return out;
}

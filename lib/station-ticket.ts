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

import { ESC, placeLines, WIDTH, itemRows, partRows, ruleText, stringToBytes, ticketRows, wrap, type TicketPayload } from './escpos';
import { noteLines } from './order-note';
import { rasterize, type Line } from './raster';
import { ticketFontReady } from './ticket-font';
import { formatDayMonthTime } from './dates';

// Dish names a step up from `big`, wider as well as taller, so the cook can read
// them at arm's length. Wrapped to fewer columns to make room.
const ITEM_SCALE: [number, number] = [1.2, 1.8];
const ITEM_COLS = Math.floor(WIDTH / ITEM_SCALE[0]);

// A note slip has nothing on it to match against the ticket already on the rail
// except the order number, so that is what has to be readable from across the
// kitchen.
const NOTE_NUMBER_SCALE: [number, number] = [2, 2.5];

// The guest's words under Qeyd: taller than the address so the cook sees them,
// smaller than the dish names. Same width, so the rows wrap as on screen.
export const QEYD_SCALE: [number, number] = [1, 1.3];

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
export async function buildStationTicketRaster(p: TicketPayload, tableName?: (id: number) => string): Promise<Uint8Array> {
  const place = (t: number) => (tableName ? tableName(t) : `Masa ${t}`);

  const when = formatDayMonthTime(p.at);
  const skip = { k: 'skip' } as const;

  // Station and time on one row at the top; the heading under them in white on
  // black, so new, extra and cancelled read apart from across the kitchen.
  const lines: Line[] = [{ text: p.station, big: true, center: true,
    style: { k: 'kv', left: p.station.toLocaleUpperCase('az'), right: when, strong: true } }];

  // A cancellation must be unmistakable at a glance across a hot kitchen.
  if (p.kind === 'cancel' || p.kind === 'move' || p.kind === 'note') {
    lines.push({ text: `*** ${HEADING[p.kind]} ***`, big: true, center: true, style: { k: 'bar', text: HEADING[p.kind] } });
  } else {
    lines.push({ text: HEADING[p.kind], center: true, style: { k: 'bar', text: HEADING[p.kind] } });
  }

  const number = `Sifariş #${p.orderNumber ?? '-'}`;
  const places = placeLines(p, place);
  // Where the food goes is what the cook needs most, so it is the biggest line.
  lines.push(...places.map((text, i): Line => ({ text, style: { k: 'center', size: i === 0 ? 44 : 24, weight: 800 } })));
  lines.push(
    { text: '-'.repeat(WIDTH), center: true, style: skip },
    p.kind === 'note' ? { text: number, scale: NOTE_NUMBER_SCALE, style: { k: 'center', size: 40, weight: 800 } }
      : { text: number, style: { k: 'center', size: 24, weight: 700 } },
  );

  lines.push({ text: when, style: skip });
  if (p.waiter) lines.push({ text: `Ofisiant: ${p.waiter}`, style: { k: 'center', size: 20 } });
  lines.push({ text: '='.repeat(WIDTH), style: { k: 'hr', heavy: true } });

  // A note slip has no items: the note is the whole message, so it takes their
  // place, in the same large type.
  if (p.kind === 'note') {
    wrap(p.note ?? '', WIDTH).forEach((row, n) => lines.push({ text: row, big: true,
      style: n === 0 ? { k: 'text', size: 30, weight: 700, whole: p.note ?? '' } : skip }));
  }

  // Sets as blocks, then plain dishes (escpos ticketRows). A set stands out by
  // its capitals and its parts listed under it.
  let first = true;
  for (const r of ticketRows(p.items)) {
    // Quantity first and doubled in size: from arm's length that's the only
    // number a cook needs to read correctly.
    if (r.kind === 'rule') { lines.push({ text: ruleText(r.heavy), style: { k: 'hr', heavy: r.heavy } }); first = true; continue; }
    if (r.kind === 'part') {
      // Parts are wrapped by the paper under their dot, beside their set.
      partRows(r.qty, r.name, ITEM_COLS).forEach((row, n) => lines.push({ text: row, scale: ITEM_SCALE,
        style: n === 0 ? { k: 'mod', lead: '· ', text: `${r.qty}x ${r.name}` } : skip }));
      continue;
    }
    if (r.kind === 'note') { lines.push({ text: `    ${r.text}`, style: { k: 'mod', lead: '→ ', text: r.text } }); continue; }
    // A hairline between dishes says which notes are whose.
    if (!first) lines.push({ text: '', style: { k: 'hr' } });
    first = false;
    itemRows(`${r.qty}x`, r.name, ITEM_COLS).forEach((row, n) => lines.push({ text: row, scale: ITEM_SCALE,
      style: n === 0 ? { k: 'item', qty: `${r.qty}x`, name: r.name } : skip }));
    if (r.kind === 'dish' && r.modifiers) lines.push({ text: `    ${r.modifiers}`, style: { k: 'mod', lead: '→ ', text: r.modifiers } });
  }

  lines.push({ text: '='.repeat(WIDTH), style: { k: 'hr', heavy: true } });
  // The guest's words in a box at the foot: Qeyd larger than phone and address.
  // The same rows as sizedNoteRows, each note line drawn whole by its first row.
  if (p.note && p.kind !== 'note') {
    for (const line of noteLines(p.note)) {
      const big = line.startsWith('Qeyd:');
      wrap(line, WIDTH).forEach((row, n) => {
        // Rows after the first are drawn already, but stay in the box's run.
        const style = n > 0 ? { k: 'text', box: true, cont: true } as const
          : big ? { k: 'text', size: 26, weight: 700, box: true, whole: line } as const
          : { k: 'text', size: 20, weight: 600, box: true, whole: line } as const;
        lines.push(big ? { text: row, scale: QEYD_SCALE, style } : { text: row, style });
      });
    }
  }

  await ticketFontReady();
  const head = new Uint8Array(stringToBytes(ESC.INIT + ESC.LEFT));
  const image = rasterize(lines, WIDTH);
  const tail = new Uint8Array(stringToBytes('\n\n\n' + ESC.CUT));
  const out = new Uint8Array(head.length + image.length + tail.length);
  out.set(head, 0);
  out.set(image, head.length);
  out.set(tail, head.length + image.length);
  return out;
}

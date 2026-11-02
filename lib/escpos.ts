// ESC/POS byte building, with no platform bindings — the browser sends these
// bytes over WebUSB, the print agent sends the same bytes over a TCP socket.
// Shared so a ticket can never drift between the two transports.

// The XP-Q806K's self-test reports "Char line FontA/B: 48/64" at a 72mm print
// width. We lay out to 47 rather than 48 on purpose: a line that exactly fills
// the carriage makes the printer wrap on its own, and that wrap lands on top of
// our own newline — which is what pushed every price one row below its name.
import { noteLines } from './order-note';
import { PLACE_WORDS } from './order-place';
import { formatDayMonthTime } from './dates';

export const WIDTH = 47;

// CP857 (IBM Turkish) carries every Azerbaijani letter except ə. The index is
// not standardised across ESC/POS clones: the XP-Q806K's self-test lists it as
// "61:PC857(Turkey)", far outside the Epson-compatible range. A printer ignores
// an index it doesn't know instead of refusing it, so a wrong value here shows
// up only as garbled letters — hold the FEED button at power-on to reprint the
// self-test and read the real number off the paper.
export const CODEPAGE_CP857 = 61;

export const ESC = {
  INIT:      '\x1B\x40',
  CODEPAGE:  `\x1B\x74${String.fromCharCode(CODEPAGE_CP857)}`,
  CENTER:    '\x1B\x61\x01',
  LEFT:      '\x1B\x61\x00',
  BIG:       '\x1B\x21\x10',   // double height
  NORMAL:    '\x1B\x21\x00',
  BOLD_ON:   '\x1B\x45\x01',
  BOLD_OFF:  '\x1B\x45\x00',
  CUT:       '\x1D\x56\x41\x00',
  DRAWER:    '\x1B\x70\x00\x19\xFF',
} as const;

// Where each Azerbaijani letter lives in CP857. ə/Ə are the one gap — no ESC/POS
// codepage has them — so those alone stay transliterated: "Şəkərbura" prints as
// "Şekerbura", with every other letter intact.
const CP857: Record<string, number> = {
  'ç': 0x87, 'Ç': 0x80,
  'ğ': 0xA7, 'Ğ': 0xA6,
  'ı': 0x8D, 'İ': 0x98,
  'ö': 0x94, 'Ö': 0x99,
  'ş': 0x9F, 'Ş': 0x9E,
  'ü': 0x81, 'Ü': 0x9A,
  'ə': 0x65, 'Ə': 0x45,   // no codepage has these — closest ASCII
  '₼': 0x6D,
};

// Byte values above 0x7F mean different letters in CP857 than they do in the
// Unicode/Latin-1 range they came from, so only ASCII passes through untouched.
export function stringToBytes(str: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const code = str.charCodeAt(i);
    if (code < 0x80) bytes.push(code);
    else bytes.push(CP857[ch] ?? 0x3F);
  }
  return bytes;
}

export function encode(parts: string[]): Uint8Array {
  return new Uint8Array(stringToBytes(parts.join('')));
}

// One item as ticket rows: quantity in a 4-column gutter, then the name
// word-wrapped under itself. Set menus run to 90+ characters ("Oliqarx Süfrə
// (1 pizza + 2 lahmacun + …)"), and cutting them at the edge hid exactly the
// part that tells the cook what goes in the bag.
// `cols` is narrower when the rows are printed in wider letters.
export function itemRows(qty: string, name: string, cols = WIDTH): string[] {
  return wrap(name, cols - 4).map((r, i) => (i === 0 ? qty.padEnd(4) : '    ') + r);
}

// Word-wrap to `cols`. A single word longer than a row is split hard; nothing else is.
export function wrap(text: string, cols: number): string[] {
  const rows: string[] = [];
  let row = '';
  for (const word of text.trim().split(/\s+/)) {
    for (let w = word; w; w = w.slice(cols)) {
      const piece = w.slice(0, cols);
      if (!row) row = piece;
      else if (row.length + 1 + piece.length <= cols) row += ' ' + piece;
      else { rows.push(row); row = piece; }
    }
  }
  rows.push(row);
  return rows;
}

// An order's note as ticket rows, word-wrapped. An online order's note is
// "Tel: … · Ünvan: … · what the guest wrote", and printed as one line it ran
// off the paper and took the guest's words with it (Test Restoran, 2026-10-05,
// "Dolmaları sarımsaqsız…"). Phone and address get a row each, and the guest's
// words come last under Qeyd, where the cook looks for them.
export function noteRows(note: string, cols = WIDTH): string[] {
  return sizedNoteRows(note, cols).map(r => r.text);
}

// The same rows, with the guest's words marked big: the cook kept missing them
// in small type under the address (Test Restoran, 2026-10-05). Big is double
// height only, so the rows wrap at the same width.
export function sizedNoteRows(note: string, cols = WIDTH): { text: string; big: boolean }[] {
  return noteLines(note).flatMap(line => {
    const big = line.startsWith('Qeyd:');
    return wrap(line, cols).map(text => ({ text, big }));
  });
}

// What the trigger froze into print_jobs.payload.
export interface TicketItem {
  name: string;
  qty: number;
  modifiers?: string | null;
  // A set's part: the set's name and count, and its order line, so the part
  // prints under its set (ticketRows). Absent on a dish, and on any ticket
  // queued before 20261109_set_block_tickets.sql.
  set?: string | null;
  setQty?: number | null;
  setKey?: string | null;
}

/** One row of a ticket's dish list, before it is drawn. */
export type TicketRow =
  | { kind: 'set'; qty: number; name: string; modifiers?: string | null }
  | { kind: 'part'; qty: number; name: string }
  | { kind: 'dish'; qty: number; name: string; modifiers?: string | null }
  | { kind: 'rule'; heavy: boolean };

/**
 * A ticket's dishes as the cook reads them: each set once, upper-case, with its
 * parts at this sex under it and a dotted line between sets; then a double line
 * and the plain dishes. A set's note is shown once, under its name.
 *
 *   2x ECO LAHMACUN SET
 *     · 2x Fri · yarim
 *   - - - - - - - - - -
 *   1x AİLƏ SETİ
 *     · 1x Plov
 *   ===================
 *   1x Çoban salatı
 */
export function ticketRows(items: TicketItem[]): TicketRow[] {
  const sets = new Map<string, { name: string; qty: number; modifiers?: string | null; parts: TicketItem[] }>();
  const dishes: TicketItem[] = [];
  for (const item of items) {
    if (!item.set) { dishes.push(item); continue; }
    const key = item.setKey ?? `${item.set}|${item.setQty}|${item.modifiers ?? ''}`;
    const block = sets.get(key) ?? { name: item.set, qty: item.setQty ?? 1, modifiers: item.modifiers, parts: [] };
    block.parts.push(item);
    sets.set(key, block);
  }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'az');
  const rows: TicketRow[] = [];
  [...sets.values()].sort(byName).forEach((block, i) => {
    if (i > 0) rows.push({ kind: 'rule', heavy: false });
    rows.push({ kind: 'set', qty: block.qty, name: block.name.toLocaleUpperCase('az'), modifiers: block.modifiers });
    for (const p of block.parts.sort(byName)) rows.push({ kind: 'part', qty: p.qty, name: p.name });
  });
  if (rows.length > 0 && dishes.length > 0) rows.push({ kind: 'rule', heavy: true });
  for (const d of dishes.sort(byName)) rows.push({ kind: 'dish', qty: d.qty, name: d.name, modifiers: d.modifiers });
  return rows;
}

/** A set's part, indented under its set: "  · 2x Fri · yarim", wrapped under its name. */
export function partRows(qty: number, name: string, cols = WIDTH): string[] {
  const lead = `  · ${qty}x `;
  return wrap(name, cols - lead.length).map((r, i) => (i === 0 ? lead : ' '.repeat(lead.length)) + r);
}

/** The dotted line between sets, and the double one before the plain dishes. */
export function ruleText(heavy: boolean, cols = WIDTH): string {
  return heavy ? '='.repeat(cols) : '- '.repeat(Math.floor(cols / 2)).trimEnd();
}

export interface TicketPayload {
  kind: 'new' | 'append' | 'cancel' | 'move' | 'note';
  station: string;
  orderNumber: number | null;
  table: number | null;
  fromTable?: number | null;  // 'move' only: where the order sat before
  // Set on a courier order. Without it the ticket says "Takeaway" and the food
  // waits on the counter for a guest who is not coming.
  courier?: string | null;
  // A guest's order from the menu link. With no rider on it yet it is still a
  // delivery, and "Takeaway" sent the food to the counter (Latte Art,
  // 2026-10-05).
  online?: boolean;
  waiter: string | null;
  note?: string | null;
  at: string;
  items: TicketItem[];
}

/**
 * Where the food goes, in the words the till's screen uses (PLACE_WORDS):
 * the table, or "Onlayn sifariş" / "Çatdırılma" / "Takeaway", with the rider
 * on a line of his own once there is one. A move slip names both tables.
 */
export function placeLines(p: TicketPayload, place: (table: number) => string): string[] {
  if (p.kind === 'move') {
    const name = (t: number | null | undefined) => (t ? place(t) : PLACE_WORDS.takeaway);
    return [`${name(p.fromTable)} -> ${name(p.table)}`];
  }
  if (p.table) return [place(p.table)];
  const head = p.online ? PLACE_WORDS.online : p.courier ? PLACE_WORDS.delivery : PLACE_WORDS.takeaway;
  return p.courier ? [head, `Kuryer: ${p.courier}`] : [head];
}

const HEADING: Record<TicketPayload['kind'], string> = {
  new:    'YENİ SİFARİŞ',
  append: 'ƏLAVƏ',        // items added to an order the kitchen already has
  cancel: 'LƏĞV',         // stop cooking these
  move:   'MASA DƏYİŞDİ', // same food, new table — don't run it to the old one
  note:   'QEYD',         // only the note changed; no items on the slip
};

// A kitchen ticket carries no prices — the cook doesn't need them, and they
// crowd out the thing that matters: what to make, and how many.
export function buildStationTicket(p: TicketPayload): Uint8Array {
  const when = formatDayMonthTime(p.at);

  const lines: string[] = [
    ESC.INIT,
    ESC.CODEPAGE,
    ESC.CENTER,
    ESC.BIG,
    `${p.station}\n`,
    ESC.NORMAL,
  ];

  // A cancellation must be unmistakable at a glance across a hot kitchen.
  if (p.kind === 'cancel') {
    lines.push(ESC.BIG, ESC.BOLD_ON, '*** LƏĞV ***\n', ESC.BOLD_OFF, ESC.NORMAL);
  } else if (p.kind === 'move') {
    lines.push(ESC.BIG, ESC.BOLD_ON, '*** MASA DƏYİŞDİ ***\n', ESC.BOLD_OFF, ESC.NORMAL);
  } else if (p.kind === 'note') {
    lines.push(ESC.BIG, ESC.BOLD_ON, '*** QEYD ***\n', ESC.BOLD_OFF, ESC.NORMAL);
  } else {
    lines.push(ESC.BOLD_ON, `${HEADING[p.kind]}\n`, ESC.BOLD_OFF);
  }

  lines.push(
    '-'.repeat(WIDTH) + '\n',
    ESC.LEFT,
    `Sifariş #${p.orderNumber ?? '-'}\n`,
  );
  // Bold: across a hot kitchen this line says where the plate goes.
  lines.push(ESC.BOLD_ON, ...placeLines(p, t => `Masa ${t}`).map(l => `${l}\n`), ESC.BOLD_OFF);
  lines.push(`${when}\n`);
  if (p.waiter) lines.push(`Ofisiant: ${p.waiter}\n`);
  lines.push('='.repeat(WIDTH) + '\n');

  // A note slip has no items: the note is the whole message, so it takes their
  // place, in the same large type.
  if (p.kind === 'note') {
    for (const row of wrap(p.note ?? '', WIDTH)) lines.push(ESC.BIG, `${row}\n`, ESC.NORMAL);
  }

  for (const r of ticketRows(p.items)) {
    // Quantity first and doubled in size: from arm's length that's the only
    // number a cook needs to read correctly.
    if (r.kind === 'rule') { lines.push(`${ruleText(r.heavy)}\n`); continue; }
    if (r.kind === 'part') {
      for (const row of partRows(r.qty, r.name)) lines.push(ESC.BIG, `${row}\n`, ESC.NORMAL);
      continue;
    }
    if (r.kind === 'set') lines.push(ESC.BOLD_ON);
    for (const row of itemRows(`${r.qty}x`, r.name)) {
      lines.push(ESC.BIG, `${row}\n`, ESC.NORMAL);
    }
    if (r.kind === 'set') lines.push(ESC.BOLD_OFF);
    if (r.modifiers) lines.push(`    ${r.modifiers}\n`);
  }

  lines.push('='.repeat(WIDTH) + '\n');
  if (p.note && p.kind !== 'note') {
    for (const row of sizedNoteRows(p.note)) {
      lines.push(...(row.big ? [ESC.BIG, `${row.text}\n`, ESC.NORMAL] : [`${row.text}\n`]));
    }
  }
  lines.push('\n\n\n', ESC.CUT);

  return encode(lines);
}

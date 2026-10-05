// ESC/POS byte building, with no platform bindings — the browser sends these
// bytes over WebUSB, the print agent sends the same bytes over a TCP socket.
// Shared so a ticket can never drift between the two transports.

// The XP-Q806K's self-test reports "Char line FontA/B: 48/64" at a 72mm print
// width. We lay out to 47 rather than 48 on purpose: a line that exactly fills
// the carriage makes the printer wrap on its own, and that wrap lands on top of
// our own newline — which is what pushed every price one row below its name.
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
  const parts = note.split(/\n| · /).map(s => s.trim()).filter(Boolean);
  const contact = parts.filter(s => /^(Tel|Ünvan):/.test(s));
  const rest = parts.filter(s => !/^(Tel|Ünvan):/.test(s)).join(' · ');
  return [
    ...contact.flatMap(s => wrap(s, cols)),
    ...(rest ? wrap(`Qeyd: ${rest}`, cols) : []),
  ];
}

// What the trigger froze into print_jobs.payload.
export interface TicketItem {
  name: string;
  qty: number;
  modifiers?: string | null;
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
  waiter: string | null;
  note?: string | null;
  at: string;
  items: TicketItem[];
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
  const when = new Date(p.at).toLocaleString('az-AZ', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });

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

  const tableLabel = (t: number | null | undefined) => (t ? String(t) : 'Takeaway');

  lines.push(
    '-'.repeat(WIDTH) + '\n',
    ESC.LEFT,
    `Sifariş #${p.orderNumber ?? '-'}\n`,
  );
  // The old table is the whole point of a move slip: the ticket already at this
  // station names it, and that's the one being corrected.
  if (p.kind === 'move') {
    lines.push(ESC.BOLD_ON, `Masa: ${tableLabel(p.fromTable)} -> ${tableLabel(p.table)}\n`, ESC.BOLD_OFF);
  } else if (p.courier) {
    lines.push(ESC.BOLD_ON, `KURYER: ${p.courier}\n`, ESC.BOLD_OFF);
  } else {
    lines.push(`Masa: ${tableLabel(p.table)}\n`);
  }
  lines.push(`${when}\n`);
  if (p.waiter) lines.push(`Ofisiant: ${p.waiter}\n`);
  lines.push('='.repeat(WIDTH) + '\n');

  // A note slip has no items: the note is the whole message, so it takes their
  // place, in the same large type.
  if (p.kind === 'note') {
    for (const row of wrap(p.note ?? '', WIDTH)) lines.push(ESC.BIG, `${row}\n`, ESC.NORMAL);
  }

  for (const item of p.items) {
    // Quantity first and doubled in size: from arm's length that's the only
    // number a cook needs to read correctly.
    for (const row of itemRows(`${item.qty}x`, item.name)) {
      lines.push(ESC.BIG, `${row}\n`, ESC.NORMAL);
    }
    if (item.modifiers) lines.push(`    ${item.modifiers}\n`);
  }

  lines.push('='.repeat(WIDTH) + '\n');
  if (p.note && p.kind !== 'note') for (const row of noteRows(p.note)) lines.push(`${row}\n`);
  lines.push('\n\n\n', ESC.CUT);

  return encode(lines);
}

// ESC/POS byte building, with no platform bindings — the browser sends these
// bytes over WebUSB, the print agent sends the same bytes over a TCP socket.
// Shared so a ticket can never drift between the two transports.

export const WIDTH = 32;   // Xprinter XP-Q806K, 58mm roll

// CP857 (IBM Turkish) carries every Azerbaijani letter except ə. The index the
// printer wants for it is not standardised across ESC/POS clones — 13 is the
// Epson-compatible value the XP-Q806K uses. If accented letters come out as
// garbage after a firmware change, printCodepageTest() below finds the new one.
export const CODEPAGE_CP857 = 13;

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

// What the trigger froze into print_jobs.payload.
export interface TicketItem {
  name: string;
  qty: number;
  modifiers?: string | null;
}

export interface TicketPayload {
  kind: 'new' | 'append' | 'cancel' | 'move';
  station: string;
  orderNumber: number | null;
  table: number | null;
  fromTable?: number | null;  // 'move' only: where the order sat before
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
  } else {
    lines.push(`Masa: ${tableLabel(p.table)}\n`);
  }
  lines.push(`${when}\n`);
  if (p.waiter) lines.push(`Ofisiant: ${p.waiter}\n`);
  lines.push('='.repeat(WIDTH) + '\n');

  for (const item of p.items) {
    // Quantity first and doubled in size: from arm's length that's the only
    // number a cook needs to read correctly.
    const qty = `${item.qty}x`;
    const name = item.name.substring(0, WIDTH - 5);
    lines.push(ESC.BIG, `${qty.padEnd(4)}${name}\n`, ESC.NORMAL);
    if (item.modifiers) lines.push(`    ${item.modifiers}\n`);
  }

  lines.push('='.repeat(WIDTH) + '\n');
  if (p.note) lines.push(`Qeyd: ${p.note}\n`);
  lines.push('\n\n\n', ESC.CUT);

  return encode(lines);
}

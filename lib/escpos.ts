// ESC/POS byte building, with no platform bindings — the browser sends these
// bytes over WebUSB, the print agent sends the same bytes over a TCP socket.
// Shared so a ticket can never drift between the two transports.

const WIDTH = 32;   // Xprinter XP-Q806K, 58mm roll

export const ESC = {
  INIT:      '\x1B\x40',
  CENTER:    '\x1B\x61\x01',
  LEFT:      '\x1B\x61\x00',
  BIG:       '\x1B\x21\x10',   // double height
  NORMAL:    '\x1B\x21\x00',
  BOLD_ON:   '\x1B\x45\x01',
  BOLD_OFF:  '\x1B\x45\x00',
  CUT:       '\x1D\x56\x41\x00',
  DRAWER:    '\x1B\x70\x00\x19\xFF',
} as const;

// The printer's codepage has no Azerbaijani letters, so they are transliterated
// to their closest ASCII form: "Balıq qızartması" prints as "Baliq qizartmasi".
// Anything else outside Latin-1 becomes '?' rather than garbage bytes.
const AZ_MAP: Record<string, number> = {
  'ə': 0x65, 'Ə': 0x45,
  'ğ': 0x67, 'Ğ': 0x47,
  'ı': 0x69, 'İ': 0x49,
  'ş': 0x73, 'Ş': 0x53,
  '₼': 0x6D,
};

export function stringToBytes(str: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const code = str.charCodeAt(i);
    if (code < 256) bytes.push(code);
    else bytes.push(AZ_MAP[ch] ?? 0x3F);
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
  new:    'YENI SIFARIS',
  append: 'ELAVE',        // items added to an order the kitchen already has
  cancel: 'LEGV',         // stop cooking these
  move:   'MASA DEYISDI', // same food, new table — don't run it to the old one
};

// A kitchen ticket carries no prices — the cook doesn't need them, and they
// crowd out the thing that matters: what to make, and how many.
export function buildStationTicket(p: TicketPayload): Uint8Array {
  const when = new Date(p.at).toLocaleString('az-AZ', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  const lines: string[] = [
    ESC.INIT,
    ESC.CENTER,
    ESC.BIG,
    `${p.station}\n`,
    ESC.NORMAL,
  ];

  // A cancellation must be unmistakable at a glance across a hot kitchen.
  if (p.kind === 'cancel') {
    lines.push(ESC.BIG, ESC.BOLD_ON, '*** LEGV ***\n', ESC.BOLD_OFF, ESC.NORMAL);
  } else if (p.kind === 'move') {
    lines.push(ESC.BIG, ESC.BOLD_ON, '*** MASA DEYISDI ***\n', ESC.BOLD_OFF, ESC.NORMAL);
  } else {
    lines.push(ESC.BOLD_ON, `${HEADING[p.kind]}\n`, ESC.BOLD_OFF);
  }

  const tableLabel = (t: number | null | undefined) => (t ? String(t) : 'Takeaway');

  lines.push(
    '-'.repeat(WIDTH) + '\n',
    ESC.LEFT,
    `Sifaris #${p.orderNumber ?? '-'}\n`,
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

// A font for tickets that ships with the page.
//
// Tickets are drawn on a canvas with whatever monospace face the device has
// (lib/raster.ts). Windows has Consolas and prints ə; an Android phone has none
// of the named faces, and its own monospace has no ə — "Pivə" printed as "Piv□"
// and "ÖDƏNİLƏCƏK" lost every Ə (Natiq, Test Restoran, 2026-10-21). This copy of
// DejaVu Sans Mono Bold sits after the system faces in the stack, so it only
// fills in where they are missing and the exe's tickets stay as they were.

export const TICKET_FONT = 'Possiblle Ticket Mono';
export const TICKET_FONT_URL = '/fonts/DejaVuSansMono-Bold.ttf';

// The face receipts and kitchen tickets are drawn in (lib/paper.ts). Shipped,
// not the device's: every till prints the same paper, and Montserrat has ə, ₼
// and the Cyrillic a menu may carry. One variable file covers every weight.
export const PAPER_FONT = 'Possiblle Paper';
export const PAPER_FONT_URL = '/fonts/Montserrat.ttf';

const FACES: [family: string, url: string, weight: string][] = [
  [TICKET_FONT, TICKET_FONT_URL, 'bold'],
  [PAPER_FONT, PAPER_FONT_URL, '100 900'],
];

const loading = new Map<string, Promise<void>>();

function loadFace([family, url, weight]: (typeof FACES)[number]): Promise<void> {
  let p = loading.get(family);
  if (!p) {
    p = new FontFace(family, `url(${url})`, { weight })
      .load()
      .then(face => { document.fonts.add(face); })
      .catch(err => {
        loading.delete(family);
        console.error('[print] ticket font', family, err instanceof Error ? err.message : String(err));
      });
    loading.set(family, p);
  }
  return p;
}

// Await before drawing a ticket. A canvas does not wait for a font: one drawn
// before the file arrives falls back silently, ə and all. Never throws — a ticket
// with a □ beats no ticket — and a failed load is tried again on the next one.
export async function ticketFontReady(): Promise<void> {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return;
  await Promise.all(FACES.map(loadFace));
}

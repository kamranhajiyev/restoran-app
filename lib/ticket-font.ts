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

let loading: Promise<void> | null = null;

// Await before drawing a ticket. A canvas does not wait for a font: one drawn
// before the file arrives falls back silently, ə and all. Never throws — a ticket
// with a □ beats no ticket — and a failed load is tried again on the next one.
export function ticketFontReady(): Promise<void> {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return Promise.resolve();
  loading ??= new FontFace(TICKET_FONT, `url(${TICKET_FONT_URL})`, { weight: 'bold' })
    .load()
    .then(face => { document.fonts.add(face); })
    .catch(err => {
      loading = null;
      console.error('[print] ticket font', err instanceof Error ? err.message : String(err));
    });
  return loading;
}

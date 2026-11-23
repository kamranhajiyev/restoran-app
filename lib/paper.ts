// Receipts, bills and kitchen tickets drawn in a proportional face (Montserrat,
// shipped in public/fonts) instead of monospace columns. A paper is still a
// list of Lines whose `text` is the plain wording — tests and the history
// report read that — and each line's `style` says how it is drawn here: a row
// with its money on the right, a table row, the boxed total, a dish with its
// quantity beside it. Lines without a style don't come here (lib/raster.ts).
//
// The printer prints only black dots on 576 columns (72mm at 203dpi), so
// toRaster() in raster.ts still decides every dot; this file only lays out.

import type { Line, Logo } from './raster';
import { code128Modules } from './code128';
import { PAPER_FONT, TICKET_FONT } from './ticket-font';

export type Style =
  | { k: 'title' }                                   // the company's name
  | { k: 'bar'; text: string }                       // heading in white on black
  | { k: 'center'; size?: number; weight?: number }  // the line's text, centred and wrapped
  // Left, wrapped. Consecutive `box` lines share one frame; `cont` is a row the
  // line before already drew (a wrapped note), kept only so the frame holds.
  // `whole` is the full wording when the line's own text is only its first
  // monospace row; the paper re-wraps it to its own width.
  | { k: 'text'; size?: number; weight?: number; box?: boolean; cont?: boolean; whole?: string }
  | { k: 'kv'; left: string; right: string; strong?: boolean; size?: number }
  | { k: 'total'; left: string; right: string }      // the amount to pay, boxed
  | { k: 'cols'; cells: [string, string, string, string]; note?: string; head?: boolean }
  | { k: 'item'; qty: string; name: string }         // a dish on a kitchen ticket
  | { k: 'mod'; lead: string; text: string }         // under a dish: its note, or a set's part
  | { k: 'hr'; heavy?: boolean }
  | { k: 'gap'; h?: number }
  | { k: 'skip' };                                   // drawn already by the line before it

export const DOTS = 576;
const PAD_X = 14;
const PAD_Y = 10;
const RIGHT = DOTS - PAD_X;
const INNER = RIGHT - PAD_X;
const STACK = `"${PAPER_FONT}", "${TICKET_FONT}", sans-serif`;

// Body text is not bold: the user picked a smooth face over a heavy one
// (2026-11-20). Headings and numbers that a reader hunts for are heavier.
const BODY = 22, BODY_W = 500;
const LOGO_MAX_W = 380, LOGO_MAX_H = 180, LOGO_GAP = 14;
const QTY_W = 96;                // the kitchen's quantity column: room for "12x"
export const KITCHEN_ITEM = 37;  // a dish's name on a kitchen ticket
export const KITCHEN_MOD = 30;   // a set's part or a note under a dish

/** A note row in pieces, with only the word ŞƏRH: in bold (Natiq, 2026-11-23). */
export function noteSegments(row: string): { text: string; bold: boolean }[] {
  const WORD = 'ŞƏRH:';
  const out: { text: string; bold: boolean }[] = [];
  let rest = row;
  for (let at = rest.indexOf(WORD); at >= 0; at = rest.indexOf(WORD)) {
    if (at > 0) out.push({ text: rest.slice(0, at), bold: false });
    out.push({ text: WORD, bold: true });
    rest = rest.slice(at + WORD.length);
  }
  if (rest) out.push({ text: rest, bold: false });
  return out;
}
const COL = { qty: 70, price: 100, total: 104 } as const;
const BARCODE_H = 80;

const font = (size: number, weight = BODY_W, italic = false) =>
  `${italic ? 'italic ' : ''}${weight} ${size}px ${STACK}`;

/** Word-wrap to a width in dots. A word wider than the row is split by letter. */
export function wrapToWidth(text: string, maxW: number, measure: (s: string) => number): string[] {
  const rows: string[] = [];
  let row = '';
  for (const word of text.trim().split(/\s+/)) {
    let w = word;
    while (measure(w) > maxW && w.length > 1) {
      let cut = w.length - 1;
      while (cut > 1 && measure(w.slice(0, cut)) > maxW) cut--;
      if (row) { rows.push(row); row = ''; }
      rows.push(w.slice(0, cut));
      w = w.slice(cut);
    }
    if (!row) row = w;
    else if (measure(`${row} ${w}`) <= maxW) row += ` ${w}`;
    else { rows.push(row); row = w; }
  }
  rows.push(row);
  return rows;
}

/**
 * A logo as black dots on white, cut to its ink. A logo on a dark ground
 * (Şəhrizad's: white letters on navy) printed as a black block with the name
 * in it; when the border is dark the light pixels become the ink instead.
 * Transparent pixels are paper. Null when nothing would print.
 */
export function cleanLogo(px: Uint8ClampedArray, w: number, h: number):
  { ink: Uint8Array; x: number; y: number; w: number; h: number } | null {
  const lum = (i: number) => px[i * 4 + 3] < 128 ? 255 : (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000;
  let edge = 0, n = 0;
  for (let x = 0; x < w; x++) { edge += lum(x) + lum((h - 1) * w + x); n += 2; }
  for (let y = 0; y < h; y++) { edge += lum(y * w) + lum(y * w + w - 1); n += 2; }
  const dark = edge / n < 128;
  const ink = new Uint8Array(w * h);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const on = px[i * 4 + 3] >= 128 && (dark ? lum(i) > 128 : lum(i) < 176);
    if (!on) continue;
    ink[i] = 1;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  return { ink, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function logoCanvas(logo: Logo): HTMLCanvasElement | null {
  const src = document.createElement('canvas');
  src.width = logo.width; src.height = logo.height;
  const sx = src.getContext('2d', { willReadFrequently: true })!;
  sx.drawImage(logo, 0, 0);
  const clean = cleanLogo(sx.getImageData(0, 0, logo.width, logo.height).data, logo.width, logo.height);
  if (!clean) return null;
  const out = document.createElement('canvas');
  out.width = clean.w; out.height = clean.h;
  const ox = out.getContext('2d')!;
  const img = ox.createImageData(clean.w, clean.h);
  for (let y = 0; y < clean.h; y++) for (let x = 0; x < clean.w; x++) {
    const v = clean.ink[(y + clean.y) * logo.width + x + clean.x] ? 0 : 255;
    const j = (y * clean.w + x) * 4;
    img.data[j] = img.data[j + 1] = img.data[j + 2] = v; img.data[j + 3] = 255;
  }
  ox.putImageData(img, 0, 0);
  return out;
}

// Lays the paper out; with `draw` false it only measures, so the canvas can be
// made the right height before anything is drawn on it.
function paint(ctx: CanvasRenderingContext2D, lines: Line[], logo: HTMLCanvasElement | null, draw: boolean): number {
  const measure = (f: string) => (s: string) => { ctx.font = f; return ctx.measureText(s).width; };
  const text = (s: string, x: number, y: number, f: string, align: CanvasTextAlign = 'left') => {
    if (!draw) return;
    ctx.font = f; ctx.textAlign = align; ctx.fillText(s, x, y);
  };
  const rect = (x: number, y: number, w: number, h: number) => { if (draw) ctx.fillRect(x, y, w, h); };
  const frame = (x: number, y: number, w: number, h: number, t: number) => {
    rect(x, y, w, t); rect(x, y + h - t, w, t); rect(x, y, t, h); rect(x + w - t, y, t, h);
  };

  let y = PAD_Y;
  if (logo) {
    const s = Math.min(LOGO_MAX_W / logo.width, LOGO_MAX_H / logo.height, 1.6);
    const w = Math.round(logo.width * s), h = Math.round(logo.height * s);
    if (draw) ctx.drawImage(logo, Math.round((DOTS - w) / 2), y, w, h);
    y += h + LOGO_GAP;
  }

  let boxTop: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const st = line.style;
    if (!st) continue;
    const prevBox = boxTop !== null;
    const isBox = st.k === 'text' && !!st.box;
    if (isBox && !prevBox) { boxTop = y; y += 10; }

    switch (st.k) {
      case 'skip': break;
      case 'gap': y += st.h ?? 14; break;
      case 'hr': {
        y += 12; rect(PAD_X, y, INNER, st.heavy ? 3 : 2); y += 14; break;
      }
      case 'title': {
        const f = font(40, 800);
        for (const r of wrapToWidth(line.text.toLocaleUpperCase('az'), INNER, measure(f))) { text(r, DOTS / 2, y + 40, f, 'center'); y += 50; }
        y += 4; break;
      }
      case 'bar': {
        y += 6; rect(PAD_X, y, INNER, 52);
        if (draw) ctx.fillStyle = '#fff';
        text(st.text, DOTS / 2, y + 38, font(30, 800), 'center');
        if (draw) ctx.fillStyle = '#000';
        y += 64; break;
      }
      case 'center': {
        const size = st.size ?? BODY, f = font(size, st.weight ?? BODY_W);
        for (const r of wrapToWidth(line.text, INNER, measure(f))) { text(r, DOTS / 2, y + size, f, 'center'); y += Math.round(size * 1.3); }
        y += 4; break;
      }
      case 'text': {
        if (st.cont) break;
        const size = st.size ?? BODY, f = font(size, st.weight ?? BODY_W);
        const pad = st.box ? 14 : 0;
        for (const r of wrapToWidth(st.whole ?? line.text, INNER - 2 * pad, measure(f))) { text(r, PAD_X + pad, y + size, f); y += Math.round(size * 1.3); }
        break;
      }
      case 'kv': {
        const size = st.size ?? BODY;
        const fl = font(size), fr = font(size, st.strong ? 700 : BODY_W);
        text(st.right, RIGHT, y + size, fr, 'right');
        const room = INNER - measure(fr)(st.right) - 16;
        for (const r of wrapToWidth(st.left, Math.max(room, INNER / 2), measure(fl))) { text(r, PAD_X, y + size, fl); y += Math.round(size * 1.45); }
        break;
      }
      case 'total': {
        y += 10;
        frame(PAD_X, y, INNER, 76, 3);
        text(st.left, PAD_X + 22, y + 48, font(24, 800));
        text(st.right, RIGHT - 22, y + 54, font(40, 800), 'right');
        y += 90; break;
      }
      case 'cols': {
        const xTotal = RIGHT, xPrice = xTotal - COL.total, xQty = xPrice - COL.price;
        const nameW = xQty - COL.qty - PAD_X - 8;
        if (st.head) {
          const f = font(16, 700);
          const [a, b, c, d] = st.cells.map(s => s.toLocaleUpperCase('az'));
          text(a, PAD_X, y + 16, f); text(b, xQty, y + 16, f, 'right'); text(c, xPrice, y + 16, f, 'right'); text(d, xTotal, y + 16, f, 'right');
          y += 26; rect(PAD_X, y, INNER, 2); y += 10; break;
        }
        const f = font(BODY), fi = font(17, BODY_W, true);
        const rows = wrapToWidth(st.cells[0], nameW, measure(f));
        const [, q, p, t] = st.cells;
        text(q, xQty, y + BODY, f, 'right'); text(p, xPrice, y + BODY, f, 'right'); text(t, xTotal, y + BODY, f, 'right');
        rows.forEach((r, n) => {
          text(r, PAD_X, y + BODY, f);
          if (n < rows.length - 1) y += 30;
        });
        if (st.note) {
          const note = `(${st.note})`;
          const last = rows[rows.length - 1];
          const after = PAD_X + measure(f)(last) + 8;
          if (after + measure(fi)(note) <= PAD_X + nameW) text(note, after, y + BODY, fi);
          else for (const r of wrapToWidth(note, nameW, measure(fi))) { y += 26; text(r, PAD_X, y + BODY, fi); }
        }
        y += 38; break;
      }
      // Larger and lighter than before: heavy bold at small sizes ran together on
      // a real printer (Natiq, 2026-11-23). Only the quantity, the lead and the
      // word ŞƏRH stay heavy.
      case 'item': {
        const f = font(KITCHEN_ITEM, 600);
        text(st.qty, PAD_X, y + 36, font(40, 800));
        for (const r of wrapToWidth(st.name, INNER - QTY_W, measure(f))) { text(r, PAD_X + QTY_W, y + 36, f); y += 44; }
        y += 6; break;
      }
      case 'mod': {
        const f = font(KITCHEN_MOD, 500), fb = font(KITCHEN_MOD, 800);
        const lead = measure(fb)(st.lead);
        text(st.lead, PAD_X + QTY_W, y + KITCHEN_MOD, fb);
        // A little room kept back: the bold ŞƏRH is wider than the width it was wrapped at.
        for (const r of wrapToWidth(st.text, INNER - QTY_W - lead - 12, measure(f))) {
          let x = PAD_X + QTY_W + lead;
          for (const seg of noteSegments(r)) {
            const sf = seg.bold ? fb : f;
            text(seg.text, x, y + KITCHEN_MOD, sf);
            x += measure(sf)(seg.text);
          }
          y += KITCHEN_MOD + 8;
        }
        y += 2; break;
      }
    }

    if (line.barcode) {
      const modules = code128Modules(line.barcode);
      if (modules) {
        const total = modules.reduce((a, b) => a + b, 0) + 20;
        const unit = Math.max(1, Math.min(3, Math.floor(DOTS / total)));
        let bx = Math.round((DOTS - (total - 20) * unit) / 2);
        modules.forEach((w, n) => { if (n % 2 === 0) rect(bx, y + 4, w * unit, BARCODE_H - 8); bx += w * unit; });
      }
      y += BARCODE_H;
      text(line.text, DOTS / 2, y + 20, font(20), 'center');
      y += 30;
    }

    const next = lines[i + 1]?.style;
    if (boxTop !== null && isBox && !(next?.k === 'text' && next.box)) {
      y += 10;
      frame(PAD_X, boxTop, INNER, y - boxTop, 3);
      y += 6;
      boxTop = null;
    }
  }
  return y + PAD_Y;
}

/** The paper as pixels: white ground, black ink, 576 wide. */
export function drawPaper(lines: Line[], logo?: Logo | null): { px: Uint8ClampedArray; height: number } {
  const mark = logo ? logoCanvas(logo) : null;
  const probe = document.createElement('canvas').getContext('2d')!;
  const height = paint(probe, lines, mark, false);

  const canvas = document.createElement('canvas');
  canvas.width = DOTS;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, DOTS, height);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'alphabetic';
  paint(ctx, lines, mark, true);
  return { px: ctx.getImageData(0, 0, DOTS, height).data, height };
}

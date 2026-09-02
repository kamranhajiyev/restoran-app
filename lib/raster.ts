// Receipts are drawn as a picture rather than sent as characters.
//
// The XP-Q806K ignores ESC t for pages its self-test claims to have (13 and 61
// both went unheeded, leaving it on CP437), so no codepage can be relied on.
// Drawing the text on a canvas and shipping pixels removes the printer's
// character table from the problem entirely — and it is the only way to print
// ə at all, since no ESC/POS codepage contains U+0259.

const DOTS = 576;          // 72mm at 203dpi, the printer's full carriage
const BYTES_PER_ROW = DOTS / 8;
const NORMAL_H = 28;       // ~20px glyphs need the leading to stay readable
const BIG_H = 42;          // 1.5x, matching what ESC.BIG did vertically
const PAD_TOP = 4;
// The logo is a guest on a page laid out in text rows: give it a generous but
// bounded box so a tall or square file can't push the order itself off the
// first hand-span of paper.
const LOGO_MAX_W = 240;
const LOGO_MAX_H = 160;
const LOGO_GAP = 10;
// A raster command's height field is one byte in practice on these clones, so
// tall receipts go out as a series of bands rather than one oversized image.
const BAND_ROWS = 128;

export type Line = {
  text: string;
  big?: boolean;
  center?: boolean;
};

// Thermal heads spread ink and the paper fades, so a thin face at ~20px prints
// grey and breaks up. Bold is the single biggest legibility win available here,
// and in a monospace face it costs nothing: the advance width is identical, so
// the columns don't shift. DejaVu leads the stack for its heavy, open shapes and
// its full Azerbaijani coverage; the rest are per-platform fallbacks.
const STACK = '"DejaVu Sans Mono", "Liberation Mono", Consolas, Menlo, ui-monospace, monospace';
const WEIGHT = 'bold';

// The layout is monospace column arithmetic (WIDTH characters to a line), so the
// font has to be sized to make exactly that many characters span the carriage.
function fitFont(ctx: CanvasRenderingContext2D, cols: number): string {
  const probe = 40;
  ctx.font = `${WEIGHT} ${probe}px ${STACK}`;
  const width = ctx.measureText('0'.repeat(cols)).width;
  return `${WEIGHT} ${Math.floor((probe * DOTS) / width)}px ${STACK}`;
}

// What a logo costs in paper, decided before the canvas is sized: the file is
// scaled down to fit the box and never up, so a small mark stays small rather
// than being blown into a mess of stair-stepped edges.
function logoBox(logo: Logo): { w: number; h: number } {
  const scale = Math.min(LOGO_MAX_W / logo.width, LOGO_MAX_H / logo.height, 1);
  return { w: Math.round(logo.width * scale), h: Math.round(logo.height * scale) };
}

export type Logo = CanvasImageSource & { width: number; height: number };

export function rasterize(lines: Line[], cols: number, logo?: Logo | null): Uint8Array {
  const box = logo ? logoBox(logo) : null;
  const height = lines.reduce((h, l) => h + (l.big ? BIG_H : NORMAL_H), PAD_TOP * 2)
    + (box ? box.h + LOGO_GAP : 0);

  const canvas = document.createElement('canvas');
  canvas.width = DOTS;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, DOTS, height);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';

  ctx.font = fitFont(ctx, cols);

  let y = PAD_TOP;

  // Centred above everything, on the same white ground as the text, so the one
  // threshold in toRaster() decides its dots too.
  if (logo && box) {
    ctx.drawImage(logo, Math.round((DOTS - box.w) / 2), y, box.w, box.h);
    y += box.h + LOGO_GAP;
  }

  for (const line of lines) {
    const x = line.center ? Math.max(0, (DOTS - ctx.measureText(line.text).width) / 2) : 0;
    if (line.big) {
      // ESC.BIG was double height at unchanged width, which is what kept the
      // emphasised total in the same money column as the lines under it.
      // Scaling only the y axis reproduces that; a bolder or larger font
      // would widen the glyphs and pull the column out of line.
      ctx.save();
      ctx.translate(0, y);
      ctx.scale(1, BIG_H / NORMAL_H);
      ctx.fillText(line.text, x, 2);
      ctx.restore();
    } else {
      ctx.fillText(line.text, x, y + 2);
    }
    y += line.big ? BIG_H : NORMAL_H;
  }

  return toRaster(ctx.getImageData(0, 0, DOTS, height).data, height);
}

// 1 bit per dot, MSB first, which is what GS v 0 expects.
function toRaster(px: Uint8ClampedArray, height: number): Uint8Array {
  const out: number[] = [];

  for (let top = 0; top < height; top += BAND_ROWS) {
    const rows = Math.min(BAND_ROWS, height - top);
    const band = new Uint8Array(BYTES_PER_ROW * rows);

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < DOTS; x++) {
        const i = ((top + y) * DOTS + x) * 4;
        // Luminance, not just alpha: antialiased edges land mid-grey and the
        // threshold decides whether the dot fires. Set well above mid-grey so
        // those edge pixels print — at this size, dropping them eats most of a
        // stroke and the text comes out spindly.
        const lum = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
        if (lum < 176) band[y * BYTES_PER_ROW + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }

    out.push(0x1D, 0x76, 0x30, 0x00,
             BYTES_PER_ROW & 0xFF, BYTES_PER_ROW >> 8,
             rows & 0xFF, rows >> 8,
             ...band);
  }

  return new Uint8Array(out);
}

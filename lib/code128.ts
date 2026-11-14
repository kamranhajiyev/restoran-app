// Code 128 (set B): the barcode at the foot of a shop's receipt (SHOP-MODE.md),
// so a return can find the sale with one scan. Every reader reads it, and it
// carries letters and digits — a receipt label like "2-100125" too.
//
// Drawn into the receipt's picture (lib/raster), not sent as a printer
// command, so it prints the same on every printer the till drives.

// Bar/space widths of each symbol, in modules (11 per symbol, 13 for STOP).
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const STOP = 106;

/** The symbol values for `text`, with START B, the checksum and STOP. Null
 *  when a character is outside set B (printable ASCII). */
export function code128Values(text: string): number[] | null {
  const data: number[] = [];
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) return null;
    data.push(c - 32);
  }
  const check = (START_B + data.reduce((sum, v, i) => sum + v * (i + 1), 0)) % 103;
  return [START_B, ...data, check, STOP];
}

/** Alternating bar/space widths in modules, starting with a bar. */
export function code128Modules(text: string): number[] | null {
  const values = code128Values(text);
  if (!values) return null;
  return values.flatMap(v => [...PATTERNS[v]].map(Number));
}

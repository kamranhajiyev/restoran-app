// An Android phone printed "Pivə" as "Piv□": tickets are drawn with the device's
// font and the phone's has no ə (Natiq, Test Restoran, 2026-10-21). The page now
// carries its own font, behind the system faces so the exe prints as before.

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STACK } from '@/lib/raster';
import { TICKET_FONT, TICKET_FONT_URL } from '@/lib/ticket-font';

// Whether a TrueType file maps a character, from its Windows Unicode cmap.
function fontHas(file: Buffer, ch: string): boolean {
  const u16 = (o: number) => file.readUInt16BE(o), u32 = (o: number) => file.readUInt32BE(o);
  let cmap = 0;
  for (let i = 0; i < u16(4); i++) if (file.toString('ascii', 12 + i * 16, 16 + i * 16) === 'cmap') cmap = u32(12 + i * 16 + 8);
  let sub = 0;
  for (let i = 0; i < u16(cmap + 2); i++) {
    const r = cmap + 4 + i * 8;
    if (u16(r) === 3 && u16(r + 2) === 1) sub = cmap + u32(r + 4);
  }
  const n = u16(sub + 6) / 2, ends = sub + 14, starts = ends + n * 2 + 2, c = ch.codePointAt(0)!;
  for (let i = 0; i < n; i++) if (c <= u16(ends + i * 2)) return c >= u16(starts + i * 2);
  return false;
}

describe('ticket font', () => {
  it('ships a font with every Azerbaijani letter', () => {
    const file = readFileSync(join('public', TICKET_FONT_URL));
    for (const ch of 'əƏçÇğĞıİöÖşŞüÜ') expect(fontHas(file, ch), ch).toBe(true);
  });

  it('comes after the system faces, so the exe keeps its own, and before the generic ones', () => {
    const at = (name: string) => STACK.indexOf(name);
    expect(at(TICKET_FONT)).toBeGreaterThan(at('Consolas'));
    expect(at(TICKET_FONT)).toBeLessThan(at('monospace'));
  });

  it('every ticket drawing waits for the font first', () => {
    const draws = (src: string) => src.search(/=\s*rasterize\(/);
    const callers = readdirSync('lib').filter(f => draws(readFileSync(join('lib', f), 'utf8')) > -1);
    expect(callers.sort()).toEqual(['printer.ts', 'station-ticket.ts']);
    for (const f of callers) {
      const src = readFileSync(join('lib', f), 'utf8');
      const waits = src.indexOf('await ticketFontReady()');
      expect(waits, f).toBeGreaterThan(-1);
      expect(waits, f).toBeLessThan(draws(src));
    }
  });
});

describe('ticketFontReady', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  function fakeBrowser(fail: () => boolean) {
    const added: unknown[] = [];
    const made: string[] = [];
    vi.stubGlobal('document', { fonts: { add: (f: unknown) => added.push(f) } });
    vi.stubGlobal('FontFace', class {
      constructor(public family: string, public source: string) { made.push(`${family} ${source}`); }
      load() { return fail() ? Promise.reject(new Error('offline')) : Promise.resolve(this); }
    });
    return { added, made };
  }

  it('loads the shipped file once and adds it to the page', async () => {
    const { added, made } = fakeBrowser(() => false);
    const { ticketFontReady } = await import('@/lib/ticket-font');
    await ticketFontReady();
    await ticketFontReady();
    expect(made).toEqual([`${TICKET_FONT} url(${TICKET_FONT_URL})`]);
    expect(added).toHaveLength(1);
  });

  it('a failed load still prints, and the next ticket tries again', async () => {
    let offline = true;
    const { added, made } = fakeBrowser(() => offline);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ticketFontReady } = await import('@/lib/ticket-font');
    await expect(ticketFontReady()).resolves.toBeUndefined();
    offline = false;
    await ticketFontReady();
    expect(made).toHaveLength(2);
    expect(added).toHaveLength(1);
  });
});

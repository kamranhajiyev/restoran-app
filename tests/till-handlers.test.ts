// 2026-11-01: the list of what the exe's and the phone's page may ask their
// own database and the site for (lib/till-store/handlers.ts) had no test of its
// own. It is the wall between the page and the machine: a page that could send
// the request anywhere, or read another restaurant's settings, is a page that
// can leak the till's link. Real SQLite in a temporary folder, as in
// exe-till.test.ts.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiAnswer, Machine, TillHandlers } from '@/lib/till-store/handlers';

let dir: string;
let till: TillHandlers;
let sent: { url: string; init: { method: string; headers?: Record<string, string>; body?: string } }[];
let cached: string[];

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'till-handlers-'));
  vi.resetModules();
  (await import('@/electron/db')).openDb(dir);
  const { tillHandlers } = await import('@/lib/till-store/handlers');
  sent = [];
  cached = [];
  const machine: Machine = {
    appUrl: 'https://www.possiblle.com/',
    fetch: async (url, init): Promise<ApiAnswer> => { sent.push({ url, init }); return { ok: true, status: 200, body: '{}' }; },
    cacheImages: async urls => { cached = urls; return { cached: urls.length }; },
  };
  till = tillHandlers(machine);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const link = (token: string) => JSON.stringify({ companyId: 'c1', token, tillNumber: 1 });

describe('the till link on the machine', () => {
  it('is kept, read back and cleared', () => {
    expect(till.link()).toEqual({ link: null });
    till.setLink(link('t1'));
    expect(till.link()).toEqual({ link: link('t1') });
    till.setLink(null);
    expect(till.link().link).toBeFalsy();
  });

  it('refuses anything that is not a link', () => {
    expect(() => till.setLink(42)).toThrow();
    expect(() => till.setLink({ token: 'x' })).toThrow();
  });
});

describe("the owner's settings on the machine", () => {
  it('are kept per restaurant, so a re-pointed till does not inherit them', () => {
    till.putSettings('c1', { kassaEnabled: false });
    expect(till.settings('c1')).toEqual({ settings: { kassaEnabled: false } });
    expect(till.settings('c2')).toEqual({ settings: null });
  });

  it('refuse a missing restaurant or no settings', () => {
    expect(() => till.settings('')).toThrow();
    expect(() => till.putSettings('c1', null)).toThrow();
  });
});

describe('a request to the site', () => {
  it("goes to the build's own site, never one the page names", async () => {
    await till.api('/api/public-menu?companyId=c1');
    expect(sent[0].url).toBe('https://www.possiblle.com/api/public-menu?companyId=c1');
  });

  it('refuses anything but a plain /api path', async () => {
    for (const bad of ['https://evil.test/api/x', '//evil.test/api/x', '/api/../admin', '/api/x\r\nHost: evil', '/admin', 42]) {
      await expect(till.api(bad), String(bad)).rejects.toThrow('bad path');
    }
    expect(sent).toEqual([]);
  });

  it("carries the till's token on a read, and not on a write", async () => {
    till.setLink(link('secret-1'));
    await till.api('/api/public-orders?companyId=c1');
    await till.api('/api/add-order', { method: 'POST', body: '{}' });
    expect(sent[0].init.headers?.['x-till-token']).toBe('secret-1');
    expect(sent[1].init.method).toBe('POST');
    expect(sent[1].init.headers?.['x-till-token']).toBeUndefined();
  });
});

describe('the menu pictures', () => {
  it('are fetched only from web addresses, at most 2000', async () => {
    await till.cacheImages(['https://cdn.test/a.jpg', 'file:///etc/passwd', 'javascript:alert(1)', 7, 'http://cdn.test/b.png']);
    expect(cached).toEqual(['https://cdn.test/a.jpg', 'http://cdn.test/b.png']);
    await till.cacheImages(Array.from({ length: 2500 }, (_, i) => `https://cdn.test/${i}.jpg`));
    expect(cached).toHaveLength(2000);
  });
});

describe("the page's writes and fills", () => {
  it('fill only the known tables', () => {
    expect(till.putReference('menu_items', 'c1', [{ id: 'm1', name: 'Plov' }])).toEqual({ ok: true });
    expect(till.menu('c1').items).toHaveLength(1);
    expect(() => till.putReference('profiles', 'c1', [])).toThrow('bad table');
    expect(() => till.putReference('menu_items', 'c1', 'x')).toThrow('bad rows');
  });

  it('refuse a write with no id, no kind or no restaurant', () => {
    expect(() => till.write('', '/api/add-order', {}, 'c1')).toThrow('bad id');
    expect(() => till.write('k1', '', {}, 'c1')).toThrow('bad kind');
    expect(() => till.write('k1', '/api/add-order', {}, '')).toThrow('bad companyId');
    expect(() => till.write('k1', '/api/add-order', [], 'c1')).toThrow('bad payload');
  });
});

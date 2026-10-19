// On localhost the till's service worker served old code forever: `next dev`
// keeps one chunk name across edits, and the worker keeps /_next/static/ files
// for good. A hard reload still showed the old order list, broken by the new
// styles (2026-10-20). Real sites keep the cache; localhost skips it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(__dirname, '..', 'public/sw.js'), 'utf8');

// Runs sw.js against a fake worker and reports whether it answered a request
// for a code chunk itself (from its cache) or let the browser fetch it.
function answersChunk(host: string): boolean {
  const listeners: Record<string, (e: unknown) => void> = {};
  const self = {
    location: { hostname: host, origin: `http://${host}` },
    addEventListener: (type: string, fn: (e: unknown) => void) => { listeners[type] = fn; },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };
  const caches = { open: () => new Promise(() => {}), keys: () => Promise.resolve([]) };
  new Function('self', 'caches', src)(self, caches);
  let answered = false;
  listeners.fetch({
    request: { method: 'GET', url: `http://${host}/_next/static/chunks/app.js`, mode: 'no-cors' },
    respondWith: () => { answered = true; },
  });
  return answered;
}

describe('the till\'s service worker', () => {
  it('keeps code chunks on a real site', () => {
    expect(answersChunk('possiblle.az')).toBe(true);
  });

  it('never serves a cached chunk under next dev', () => {
    expect(answersChunk('localhost')).toBe(false);
    expect(answersChunk('127.0.0.1')).toBe(false);
  });
});

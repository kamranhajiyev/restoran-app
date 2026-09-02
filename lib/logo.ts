// The company logo, fetched in a form a canvas will let us read back.
//
// rasterize() ends in getImageData(), which throws SecurityError on a canvas
// tainted by a cross-origin image — and that would take the whole receipt down,
// not just the logo. Supabase Storage serves its public objects with
// Access-Control-Allow-Origin: *, so crossOrigin='anonymous' keeps the canvas
// clean. It has to be set before src, or the request goes out without it.
//
// Everything here fails to null on purpose: a receipt with no logo is a small
// disappointment, a receipt that never prints is a customer standing at the till.

import type { Logo } from './raster';

const TIMEOUT_MS = 3000;

// A busy till prints a receipt a minute off the same URL; fetch it once.
const cache = new Map<string, Promise<Logo | null>>();

function fetchLogo(url: string): Promise<Logo | null> {
  return new Promise(resolve => {
    const img = new Image();
    let settled = false;
    const done = (value: Logo | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    // A hanging request must not hold the paper: past this the receipt prints
    // without the logo, and the next print tries again on a fresh cache entry.
    const timer = setTimeout(() => {
      console.warn('[Logo] Vaxt bitdi, qəbz logosuz çap olunur');
      cache.delete(url);
      done(null);
    }, TIMEOUT_MS);

    img.crossOrigin = 'anonymous';
    img.onload = () => done(img.naturalWidth > 0 ? img : null);
    img.onerror = () => {
      console.warn('[Logo] Yüklənmədi, qəbz logosuz çap olunur');
      cache.delete(url);
      done(null);
    };
    img.src = url;
  });
}

export function loadLogo(url: string | null | undefined): Promise<Logo | null> {
  if (!url || typeof document === 'undefined') return Promise.resolve(null);
  let pending = cache.get(url);
  if (!pending) {
    pending = fetchLogo(url);
    cache.set(url, pending);
  }
  return pending;
}

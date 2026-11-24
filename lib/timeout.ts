// Every network read gets a time limit. Without one a hung connection left
// admin and the till on "Yüklənir..." until a reload; a timeout is a failed
// read, and the screens keep what they show on those (lib/keep-on-fail).
export const READ_MS = 60000;

/** The same limit for a promise that takes no signal (the exe's and APK's
 *  bridge): rejects when nothing came back in time. */
export function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

export function withTimeout(init: RequestInit | undefined, ms: number): RequestInit {
  return init?.signal ? init : { ...init, signal: AbortSignal.timeout(ms) };
}

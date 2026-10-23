// What the page calls that a phone's older Chrome does not have.
//
// Only the APK's copy of the page loads this (scripts/build-desktop.mjs
// --android puts it in as instrumentation-client.ts, which runs before the
// page). Each one is filled in only when missing, so a new Chrome keeps its
// own. 2026-10-22: on Chrome 91 placing an order failed with
// "crypto.randomUUID is not a function".

type Loose = Record<string, unknown>;

export function installPolyfills(g: typeof globalThis = globalThis): void {
  const c = g.crypto as Crypto & Loose;
  // Chrome 92.
  if (c && typeof c.randomUUID !== 'function') {
    c.randomUUID = () => {
      const b = c.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` as `${string}-${string}-${string}-${string}-${string}`;
    };
  }

  // Chrome 92.
  for (const proto of [g.Array.prototype, g.String.prototype] as unknown as Loose[]) {
    if (typeof proto.at !== 'function') {
      Object.defineProperty(proto, 'at', {
        configurable: true,
        writable: true,
        value(this: ArrayLike<unknown>, i: number) {
          const n = Math.trunc(i) || 0;
          const k = n < 0 ? this.length + n : n;
          return k < 0 || k >= this.length ? undefined : this[k];
        },
      });
    }
  }

  const O = g.Object as unknown as Loose;
  // Chrome 93.
  if (typeof O.hasOwn !== 'function') {
    O.hasOwn = (o: object, k: PropertyKey) => Object.prototype.hasOwnProperty.call(o, k);
  }
  // Chrome 117.
  if (typeof O.groupBy !== 'function') {
    O.groupBy = <T>(items: Iterable<T>, key: (t: T, i: number) => PropertyKey) => {
      const out = Object.create(null) as Record<PropertyKey, T[]>;
      let i = 0;
      for (const t of items) (out[key(t, i++)] ??= []).push(t);
      return out;
    };
  }

  const P = g.Promise as unknown as Loose;
  // Chrome 119.
  if (typeof P.withResolvers !== 'function') {
    P.withResolvers = () => {
      let resolve!: (v: unknown) => void;
      let reject!: (e: unknown) => void;
      const promise = new Promise((a, b) => { resolve = a; reject = b; });
      return { promise, resolve, reject };
    };
  }

  const A = g.AbortSignal as unknown as Loose | undefined;
  // Chrome 103. The till's requests give up with it rather than hang.
  if (A && typeof A.timeout !== 'function') {
    A.timeout = (ms: number) => {
      const ctl = new AbortController();
      setTimeout(() => ctl.abort(new DOMException('signal timed out', 'TimeoutError')), ms);
      return ctl.signal;
    };
  }
}

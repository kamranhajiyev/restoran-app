// Every network read gets a time limit. Without one a hung connection left
// admin and the till on "Yüklənir..." until a reload; a timeout is a failed
// read, and the screens keep what they show on those (lib/keep-on-fail).
export const READ_MS = 60000;

export function withTimeout(init: RequestInit | undefined, ms: number): RequestInit {
  return init?.signal ? init : { ...init, signal: AbortSignal.timeout(ms) };
}

// How a till proves who it is when it reads.
//
// The /api/public-* routes answered anyone who knew a company id, and the id is
// not a secret — the guest menu sends it with every request. With it a stranger
// could download every order, and online guests' phones and addresses with
// them. So a read now carries the same token the till's writes already send,
// in a header rather than the address so it stays out of the access logs.
//
// No imports: the exe's main process compiles this file too.

export const TILL_TOKEN_HEADER = 'x-till-token';

/** The reads that need the header. Writes carry the token in their body. */
export function isTillRead(path: string): boolean {
  return path.startsWith('/api/public-');
}

/** The headers to send `path` with: the caller's own, plus the token on a read. */
export function withTillToken(
  path: string,
  headers: Record<string, string> | undefined,
  token: string | null,
): Record<string, string> | undefined {
  if (!token || !isTillRead(path)) return headers;
  return { ...headers, [TILL_TOKEN_HEADER]: token };
}

/** The token out of the link the exe keeps on its disk (lib/terminal-link.ts). */
export function tokenFromLink(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const token = (JSON.parse(raw) as { token?: unknown }).token;
    return typeof token === 'string' && token ? token : null;
  } catch {
    return null;
  }
}

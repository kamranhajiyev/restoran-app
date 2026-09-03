// Which restaurant the Windows till belongs to.
//
// In a browser the answer is in the address bar: /s/<slug>/<token> carries it,
// and app/s/[slug]/[token]/page.tsx resolves it on every load. The desktop app
// has no address bar — it opens app://till/seller every time — so the same two
// values are pasted once, on the first morning, and kept on the machine.
//
// A terminal link is not a password. It identifies a till, the server decides
// what that till may do under its own token, and staff still unlock with a PIN.
// What it replaces is the owner typing their own account into a machine that
// sits on a counter all day.
//
// Kept beside the till's data in SQLite (electron/till-ipc.ts) rather than in
// localStorage, because it must survive the one thing localStorage does not:
// a profile cleared by Windows, on a machine whose line is down.

import type { PosNative } from "./desktopPrint";
import { apiBase } from "./till-write";

/** A terminal, as this machine last understood it. */
export interface Terminal {
  slug: string;
  token: string;
  /**
   * Which till in the restaurant this machine is, 1-9. Set by hand on the setup
   * screen, because it is a fact about the counter rather than about the link —
   * the same link installed on two machines is two tills. It goes onto every
   * order this machine numbers, so two tills offline at once can still be told
   * apart. See lib/order-label.ts.
   */
  tillNumber: number;
  /** Everything below is the server's last answer, kept so an outage still opens. */
  companyId: string;
  companyName: string;
  logoUrl: string | null;
  brandColor: string | null;
  expiresAt: string | null;
}

function till(): NonNullable<PosNative["till"]> | null {
  if (typeof window === "undefined") return null;
  return window.posNative?.till ?? null;
}

/** Only the bundled desktop till stores a link; everything else answers false. */
export function canLink(): boolean {
  return till() !== null;
}

/**
 * Pull the slug and token out of whatever the manager pasted.
 *
 * They will paste a whole URL from an email, or a URL with a trailing slash, or
 * just the path. All three are the same two values, and refusing two of them
 * would mean explaining the difference to someone standing at a counter.
 */
export function parseTerminalLink(input: string): { slug: string; token: string } | null {
  const text = input.trim();
  if (!text) return null;

  // Take the path whether or not there is a scheme and host in front of it. A
  // bare "https://www.possiblle.com" has no path and must come back as nothing:
  // reading the host as the slug would send the till looking for a restaurant
  // called "www.possiblle.com".
  let path = text;
  const url = text.match(/^https?:\/\/[^/]*(\/\S*)?$/i);
  if (url) path = url[1] ?? "";

  const parts = path.split("?")[0].split("#")[0].split("/").filter(Boolean);
  const at = parts.indexOf("s");
  const [slug, token] = at === -1 ? parts : parts.slice(at + 1);
  if (!slug || !token) return null;
  return { slug, token };
}

/**
 * A till number this app is willing to act on: a whole 1-9.
 *
 * Kept to one digit deliberately. It is read aloud across a room ("forty-five,
 * till two"), and a restaurant with ten counters is not the shape of business
 * this till is built for.
 */
export function normalTillNumber(value: unknown): number {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n >= 1 && n <= 9 ? n : 1;
}

export async function readLink(): Promise<Terminal | null> {
  const db = till();
  if (!db) return null;
  try {
    const { link } = await db.link();
    if (!link) return null;
    const stored = JSON.parse(link) as Terminal;
    // A link written before tills had numbers is till 1 — the only till that
    // machine could have been, since there was no way to say otherwise.
    return { ...stored, tillNumber: normalTillNumber(stored.tillNumber) };
  } catch {
    // Nothing stored, or something unparseable left by an older build. Either
    // way the manager is asked again, which is a screen with a way forward.
    return null;
  }
}

export async function saveLink(terminal: Terminal): Promise<void> {
  await till()?.setLink(JSON.stringify(terminal));
}

export async function clearLink(): Promise<void> {
  await till()?.setLink(null);
}

export type LinkCheck =
  | { status: "ok"; terminal: Terminal }
  /** The server answered, and this link is not one. */
  | { status: "invalid" }
  /** Nobody to ask. The caller keeps whatever it already had. */
  | { status: "offline" };

/**
 * Ask the server what this link is.
 *
 * The one call in the desktop till that has to reach the site rather than the
 * machine — a link nobody has ever validated cannot be trusted to a local
 * database that would then be filled from it. `apiBase()` supplies the address,
 * since app://till has no server of its own.
 */
export async function checkLink(
  slug: string,
  token: string,
  /**
   * Carried through rather than fetched: the server does not know which counter
   * this machine sits on. Passing it here means the background revalidation can
   * write the fresh answer back without losing the number someone set on the
   * first morning.
   */
  tillNumber = 1,
): Promise<LinkCheck> {
  const path = `/api/seller-token?slug=${encodeURIComponent(slug)}&token=${encodeURIComponent(token)}`;

  // On the desktop till this goes out through the main process. The page is
  // served from app://till, so a fetch straight to possiblle.com is cross-origin
  // and the browser refuses it before it is sent — which arrives here as a
  // thrown fetch, indistinguishable from a real outage. That is exactly what it
  // looked like: "İnternet yoxdur" on a machine with a working connection.
  const db = till();
  let res: { ok: boolean; status: number; body: string };
  try {
    if (db) {
      res = await db.api(path);
    } else {
      const r = await fetch(`${await apiBase()}${path}`);
      res = { ok: r.ok, status: r.status, body: await r.text() };
    }
  } catch {
    return { status: "offline" };
  }

  // 404 is the server saying the link is wrong or revoked. A 500 is the server
  // having a bad minute, and must not wipe a working till's setup.
  if (res.status === 404) return { status: "invalid" };
  if (!res.ok) return { status: "offline" };

  type Answer = {
    companyId?: string; companyName?: string;
    logoUrl?: string | null; brandColor?: string | null; expiresAt?: string | null;
  };

  let d: Answer | null;
  try {
    d = JSON.parse(res.body) as Answer;
  } catch {
    // A 200 that is not JSON is a login page or a proxy notice, not an answer.
    // Treating it as "invalid" would clear a working till's setup over what is
    // almost certainly a captive portal, so it counts as no answer at all.
    return { status: "offline" };
  }

  if (!d?.companyId) return { status: "invalid" };

  return {
    status: "ok",
    terminal: {
      slug,
      token,
      tillNumber,
      companyId: d.companyId,
      companyName: d.companyName ?? "",
      logoUrl: d.logoUrl ?? null,
      brandColor: d.brandColor ?? null,
      expiresAt: d.expiresAt ?? null,
    },
  };
}

// Where the till's data comes from.
//
// In a browser tab it is the /api/public-* routes, exactly as before. Inside the
// Windows app it is SQLite on the machine, reached over the preload bridge, and
// the network is not involved at all — which is the point: a waiter mid-service
// must never wait on a restaurant's uplink, and a reload during an outage must
// come back with the room still on it.
//
// The seam is a stand-in for fetch() rather than a set of typed functions, on
// purpose. app/seller/page.tsx is 3300 lines built around these exact request
// shapes and their .then/.catch chains; swapping the transport underneath them
// leaves that logic untouched, where a hand-written function per route would be
// twenty chances to return "almost" the right object. A wrong price is a much
// worse bug than a compile error.

import type { PosNative } from "./desktopPrint";

/** The local database, or null in a browser (and in a --url= shell). */
function local(): NonNullable<PosNative["till"]> | null {
  if (typeof window === "undefined") return null;
  return window.posNative?.till ?? null;
}

export function hasLocalDb(): boolean {
  return local() !== null;
}

/** Answer in the shape a Response would have, so callers cannot tell. */
function reply(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * The reads the till makes, mapped onto the local database.
 *
 * Returns null when the request is not one this can answer locally, which sends
 * the caller to the real network — the login POST, the push subscription, and
 * anything added later all keep working untouched.
 */
async function readLocally(url: URL): Promise<Response | null> {
  const till = local();
  if (!till) return null;

  const companyId = url.searchParams.get("companyId");
  if (!companyId) return null;

  const num = (key: string): number | undefined => {
    const raw = url.searchParams.get(key);
    if (raw === null) return undefined;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : undefined;
  };

  switch (url.pathname) {
    case "/api/public-menu":
      return reply(await till.menu(companyId));
    case "/api/public-categories":
      return reply(await till.categories(companyId));
    case "/api/public-tables":
      return reply(await till.tables(companyId));
    case "/api/public-staff":
      return reply(await till.staff(companyId));
    case "/api/public-modifiers":
      return reply(await till.modifiers(companyId));
    case "/api/public-stations":
      return reply(await till.stations(companyId));
    case "/api/public-station-ready":
      return reply(await till.stationReady(companyId));
    case "/api/public-shift":
      return reply(await till.shift(companyId));
    case "/api/public-orders":
      return reply(
        await till.orders(companyId, {
          from: url.searchParams.get("from") ?? undefined,
          to: url.searchParams.get("to") ?? undefined,
          limit: num("limit"),
          offset: num("offset"),
        }),
      );
    case "/api/public-shift-sales": {
      const openedAt = url.searchParams.get("openedAt");
      if (!openedAt) return null;
      return reply(await till.shiftSales(companyId, openedAt));
    }
    default:
      return null;
  }
}

/**
 * fetch(), but served from the machine when the machine has the answer.
 *
 * Drop-in: same arguments, same Response, same rejection on a dead network. The
 * till's existing `.then(r => r.json()).catch(() => [])` chains work unchanged.
 */
export async function tillFetch(input: string, init?: RequestInit): Promise<Response> {
  // A relative path needs an origin to parse. Inside the app that origin is
  // app://till, which no server will ever answer — so a request that falls
  // through to the network below is a bug worth seeing, not one to paper over.
  const url = new URL(input, typeof window === "undefined" ? "http://local" : window.location.href);

  if (!init || (init.method ?? "GET").toUpperCase() === "GET") {
    const answered = await readLocally(url);
    if (answered) return answered;
  }

  return fetch(input, init);
}

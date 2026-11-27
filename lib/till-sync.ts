// Filling the till's local database from Supabase.
//
// Two callers, wanting different things from the same work:
//
//   · the first run, where the machine has nothing and the waiter is waiting.
//     That one blocks, and reports each step, because there is no till to use
//     until it finishes.
//   · every run after, where it is a quiet background refresh. The owner added
//     a dish or changed a price; the till picks it up and nobody notices. If
//     the line is down it is skipped entirely — the local copy is still good.
//
// Every read here goes to the site's /api/public-* routes — the same ones the
// web terminal has always used — rather than to Supabase directly. A till set up
// from a terminal link has no login session, so a direct query is refused by RLS
// on every row, and the setup screen fills with failures on a machine whose
// connection is fine. The routes answer for one companyId and the server holds
// the key; nothing here does, and nothing here can reach another company's data.

import { setCompanyContext } from "@/lib/store";
import { isOrderOpen, type MenuItem, type ModifierGroup, type OrderStatus } from "@/types";
import type { PosNative, TillSettings } from "./desktopPrint";
import type { TillSignal } from "./till-signal";
import { cacheImages } from "./till-image";

function till(): NonNullable<PosNative["till"]> | null {
  if (typeof window === "undefined") return null;
  return window.posNative?.till ?? null;
}

/** How many orders a fresh machine pulls down. The room, not the archive. */
const ORDER_WINDOW = 200;

export type StepId =
  | "menu" | "categories" | "modifiers" | "stations"
  | "tables" | "staff" | "couriers" | "orders" | "settings" | "shift" | "images";

export interface StepProgress {
  id: StepId;
  /** Shown to the waiter, in their own language. */
  label: string;
  state: "pending" | "running" | "done" | "failed";
  /** How many rows landed — the proof the step actually did something. */
  count?: number;
  error?: string;
}

/**
 * Read one of the site's public routes, through the main process.
 *
 * Not lib/store.ts. Those helpers query Supabase directly under the reader's own
 * session, and a till set up from a terminal link has no session at all — RLS
 * refuses every row, and the setup screen fills with "alınmadı" on a machine
 * with a perfectly good connection. The /api/public-* routes are how the web
 * terminal has always read this same data: the server holds the key, the caller
 * supplies only a companyId, and the answer is the same shape either way.
 *
 * It goes out through the main process because the page is served from
 * app://till and a fetch to the site is cross-origin. See electron/till-ipc.ts.
 */
async function serverRead<T>(
  db: NonNullable<PosNative["till"]>,
  route: string,
  companyId: string,
  params: Record<string, string> = {},
): Promise<T> {
  const q = new URLSearchParams({ companyId, ...params });
  const res = await db.api(`/api/${route}?${q}`);
  // Loud on failure, deliberately. A step that swallowed an error would report
  // success and leave the till holding an empty menu — see replace() below for
  // why an empty answer is the dangerous one.
  if (!res.ok) throw new Error(`${route}: ${res.status}`);
  try {
    return JSON.parse(res.body) as T;
  } catch {
    throw new Error(`${route}: cavab oxunmadı`);
  }
}

/**
 * Replace one reference table, refusing to replace it with nothing.
 *
 * Each of these is written wholesale, which is right — the server is their only
 * author — but it makes an empty answer catastrophic: a request that returns []
 * because a token expired, or because RLS refused a terminal that has no
 * session, would blank the menu of a till that is mid-service. The local copy is
 * always the better of the two in that case, so a step that comes back empty
 * fails loudly and changes nothing.
 *
 * Only for the tables a working restaurant cannot have none of. A place with no
 * modifiers or no sexes is ordinary, and refusing those would leave the setup
 * screen showing a failure that never clears.
 */
async function replace(
  db: NonNullable<PosNative["till"]>,
  table: string,
  companyId: string,
  rows: unknown[],
  mustHaveRows = false,
): Promise<number> {
  if (mustHaveRows && rows.length === 0) throw new Error("boş cavab");
  await db.putReference(table, companyId, rows);
  return rows.length;
}

type Step = {
  id: StepId;
  label: string;
  run: (companyId: string, db: NonNullable<PosNative["till"]>) => Promise<number>;
};

// Order matters for the screen, not for correctness: the menu first because it
// is the biggest and the most reassuring to watch land.
const STEPS: Step[] = [
  {
    id: "menu",
    label: "Menyu",
    run: async (companyId, db) => {
      const { items } = await serverRead<{ items: MenuItem[] }>(db, "public-menu", companyId);
      return replace(db, "menu_items", companyId, items ?? [], true);
    },
  },
  {
    id: "categories",
    label: "Kateqoriyalar",
    run: async (companyId, db) => {
      const { categories } = await serverRead<{ categories: unknown[] }>(db, "public-categories", companyId);
      return replace(db, "categories", companyId, categories ?? [], true);
    },
  },
  {
    id: "modifiers",
    label: "Əlavələr",
    run: async (companyId, db) => {
      const { groups } = await serverRead<{ groups: unknown[] }>(db, "public-modifiers", companyId);
      return replace(db, "modifier_groups", companyId, groups ?? []);
    },
  },
  {
    id: "stations",
    label: "Sexlər",
    run: async (companyId, db) => {
      const { stations } = await serverRead<{ stations: unknown[] }>(db, "public-stations", companyId);
      return replace(db, "stations", companyId, stations ?? []);
    },
  },
  {
    id: "tables",
    label: "Masalar",
    run: async (companyId, db) => {
      // One request: the route returns both, and a table carries its hall — a
      // screen that drew the room before it knew the halls would put every
      // table in one place.
      const { tables, halls } = await serverRead<{ tables: unknown[]; halls: unknown[] }>(
        db, "public-tables", companyId,
      );
      // A place with no tables at all (takeaway, a kiosk) is ordinary, so an
      // empty room is refused only when it would wipe the room this till has.
      const local = (await db.tables(companyId)) as { tables?: unknown[] };
      await replace(db, "halls", companyId, halls ?? []);
      return replace(db, "tables", companyId, tables ?? [], (local.tables?.length ?? 0) > 0);
    },
  },
  {
    id: "staff",
    label: "İşçilər",
    run: async (companyId, db) => {
      const { staff } = await serverRead<{ staff: unknown[] }>(db, "public-staff", companyId);
      return replace(db, "staff", companyId, staff ?? []);
    },
  },
  {
    id: "couriers",
    label: "Kuryerlər",
    run: async (companyId, db) => {
      const { couriers } = await serverRead<{ couriers: Record<string, unknown>[] }>(
        db, "public-couriers", companyId,
      );
      // Each row carries the balance the server computed and the moment it did.
      // The till adds its own deliveries and settlements on top of that, counting
      // only the ones later than this stamp — see getCouriers in till-repo.ts.
      const syncedAt = new Date().toISOString();
      return replace(db, "couriers", companyId, (couriers ?? []).map(c => ({ ...c, syncedAt })));
    },
  },
  {
    id: "orders",
    label: "Açıq sifarişlər",
    run: async (companyId, db) => {
      const { orders } = await serverRead<{ orders: unknown[] }>(
        db, "public-orders", companyId, { limit: String(ORDER_WINDOW) },
      );

      // The caller checked the outbox was empty before the pull started, but the
      // pull is eleven steps long and a waiter does not stop for it. Anything
      // rung up or paid since then is on this disk and not yet on the server —
      // so the list above, fetched seconds ago, would put those rows back the
      // way they were: a paid order open again, in SQLite, where a reload cannot
      // argue with it. Leave the orders alone and let the next sweep, after the
      // outbox has drained, do it properly.
      if ((await db.outbox()).pending > 0) return 0;

      await db.putOrders(companyId, orders ?? []);
      const { ready } = await serverRead<{ ready: unknown[] }>(db, "public-station-ready", companyId);
      await db.putStationReady(companyId, ready ?? []);
      return (orders ?? []).length;
    },
  },
  {
    // Kassa on or off, tables on or off, whether a receipt prints. Small, and
    // the till obeyed none of it before: every one of these was read straight
    // off the companies row, RLS refused a session-less terminal, and each
    // helper answered its own failure with "on".
    id: "settings",
    label: "Parametrlər",
    run: async (companyId, db) => {
      const { settings } = await serverRead<{ settings: TillSettings }>(db, "public-settings", companyId);
      if (!settings) throw new Error("boş cavab");
      await db.putSettings(companyId, settings);
      return 1;
    },
  },
  {
    id: "shift",
    label: "Növbə",
    run: async (companyId, db) => {
      const { shift } = await serverRead<{ shift: { id: string } | null }>(db, "public-shift", companyId);
      // The server only ever reports the open shift, so a shift closed
      // somewhere else — the admin panel, another till — shows up here as
      // nothing, or as a newer one. Without this the till kept its old copy
      // open forever. Not while writes are queued: a shift this till has just
      // opened and not yet sent would read as closed on the server.
      if ((await db.outbox()).pending === 0) {
        const local = (await db.shift(companyId)) as { shift: { id: string } | null };
        if (local.shift && local.shift.id !== shift?.id) {
          await db.putShift(companyId, { ...local.shift, closedAt: new Date().toISOString() });
        }
      }
      if (!shift) return 0;
      await db.putShift(companyId, shift);
      return 1;
    },
  },
  {
    // Last on purpose. It is the only step whose failure costs nothing — the
    // till works without pictures — and the only one that would otherwise make
    // a waiter watch a progress bar while a hundred photographs download.
    //
    // Reads the menu back out of the local database rather than the network:
    // the steps above have already put it there, and the addresses are the same
    // ones the page will ask for.
    id: "images",
    label: "Şəkillər",
    run: async (companyId, db) => {
      const { items = [] } = (await db.menu(companyId)) as { items?: MenuItem[] };
      const { groups = [] } = (await db.modifiers(companyId)) as { groups?: ModifierGroup[] };
      const urls = [
        ...items.map(i => i.image),
        ...groups.flatMap(g => g.options?.map(o => o.image) ?? []),
      ];
      return cacheImages(urls);
    },
  },
];

export const stepList = (): StepProgress[] =>
  STEPS.map(s => ({ id: s.id, label: s.label, state: "pending" as const }));

/**
 * Bring the till's copy of the sexes up to date now.
 *
 * Called right after a sex's printer is changed from the till. Otherwise the
 * local copy — which the fast print path reads — keeps the old printer until the
 * five-minute sweep, and every ticket meanwhile goes the slow way, through the
 * queue.
 */
export async function pullStations(companyId: string): Promise<boolean> {
  const db = till();
  if (!db || !companyId) return false;
  try {
    const { stations } = await serverRead<{ stations: unknown[] }>(db, "public-stations", companyId);
    await replace(db, "stations", companyId, stations ?? []);
    return true;
  } catch {
    // The five-minute sweep will carry it.
    return false;
  }
}

/**
 * Which sexes have finished, fetched now rather than at the next sweep.
 *
 * The till reads readiness off its own disk, and that copy is only replaced by
 * the "orders" step above — five minutes apart, and skipped outright while
 * anything is waiting in the outbox. A cook tapping "Hazırdır" writes to
 * Supabase, so the waiter's screen went on showing the order unfinished until a
 * sweep happened to come round: minutes, on a busy night most of service, with
 * the food going cold on the pass.
 *
 * The till is already told the moment it changes — it has been subscribed to
 * order_station_ready all along — and answered by re-reading the disk that does
 * not have it yet. This is the missing half: one small read, only on that
 * signal.
 *
 * Deliberately not part of a pull: it touches nothing but readiness, so unlike
 * the orders step it cannot put a paid order back, and the outbox gate that
 * protects that step does not apply.
 *
 * Returns false in a browser, where there is no local copy to bring up to date
 * and the screen reads Supabase itself.
 */
export async function pullStationReady(companyId: string): Promise<boolean> {
  const db = till();
  if (!db || !companyId) return false;
  try {
    const { ready } = await serverRead<{ ready: unknown[] }>(db, "public-station-ready", companyId);
    // An empty list is an answer here, not a failure: it is what an order being
    // un-marked looks like, and refusing it would leave a card green after the
    // cook took it back. serverRead already throws on a request that failed.
    await db.putStationReady(companyId, ready ?? []);
    return true;
  } catch {
    // The next sweep will carry it. Nothing on screen should change because one
    // read did not get through.
    return false;
  }
}

/**
 * The server's orders this machine has never seen. Only new ones: an order the
 * till already holds may carry a payment or an item not sent yet, and the
 * server's older copy must never land on top of it.
 */
export function unseenOrders<T extends { id: string }>(server: T[], localIds: Set<string>): T[] {
  return server.filter(o => !localIds.has(o.id));
}

/** The open orders here worth asking about: none with unsent writes, at most 100. */
export function openOrderIds(local: { id: string; status: OrderStatus }[], pending: Set<string>): string[] {
  return local.filter(o => isOrderOpen(o) && !pending.has(o.id)).map(o => o.id).slice(0, 100);
}

/**
 * The server's copies of open orders here that it has closed. A closed order
 * never opens again, so its copy can only be newer than the open one here —
 * unless this till has writes for it still waiting to go, which win.
 */
export function closedElsewhere<T extends { id: string; status: OrderStatus }>(
  server: T[],
  openHere: Set<string>,
  pending: Set<string>,
): T[] {
  return server.filter(o => openHere.has(o.id) && !pending.has(o.id) && !isOrderOpen(o));
}

/**
 * Where the quick check starts reading: a little before the newest order this
 * machine holds, so an order the server stamped a moment earlier — another
 * till's clock, a slow request — is not stepped over. Nothing local yet means
 * the last hour.
 */
export function newOrdersSince(newestLocal: string | undefined, now: number): string {
  const t = newestLocal ? Date.parse(newestLocal) : NaN;
  return new Date((Number.isFinite(t) ? t : now - 3_600_000) - 2 * 60_000).toISOString();
}

/**
 * Orders placed somewhere else — the guest's phone, another till — brought onto
 * this machine now rather than at the next sweep.
 *
 * Test Restoran, 2026-10-05: an order from the menu link printed in the kitchen
 * at once (tickets come straight from the server) but reached the till's screen
 * minutes later, because the screen reads the local copy and only the
 * five-minute sweep put the order there.
 *
 * Asks only for orders newer than the newest one here, so on a quiet till the
 * answer is an empty list. Adds orders, never changes one; see unseenOrders.
 *
 * The one exception, asked in the same request: an open order here that the
 * server has closed — deleted or cancelled in admin, paid on another till.
 * 2026-11-27 (Natiq): an open order deleted in admin printed its LƏĞV slip at
 * once but stayed on the exe's screen about five minutes, until the sweep.
 * See closedElsewhere. `pendingIds`: orders with writes not yet sent
 * (lib/sync.ts pendingOrderIds), which are left alone — asked again just
 * before saving, since a waiter may pay one while the request is out.
 *
 * Returns how many orders changed here, new or closed.
 */
export async function pullNewOrders(
  companyId: string,
  pendingIds: () => Promise<Set<string>> = async () => new Set(),
): Promise<number> {
  const db = till();
  if (!db || !companyId) return 0;
  try {
    const pending = await pendingIds();
    const held = (await db.orders(companyId, { limit: 300 })) as { orders?: { id: string; createdAt?: string; status: OrderStatus }[] };
    const from = newOrdersSince(held.orders?.[0]?.createdAt, Date.now());
    const openHere = openOrderIds(held.orders ?? [], pending);
    const { orders = [], closed = [] } = await serverRead<{
      orders?: { id: string }[];
      closed?: { id: string; status: OrderStatus }[];
    }>(
      db, "public-orders", companyId,
      { from, limit: "30", ...(openHere.length ? { closedIds: openHere.join(",") } : {}) },
    );
    const shut = closed.length ? closedElsewhere(closed, new Set(openHere), await pendingIds()) : [];
    let fresh: { id: string }[] = [];
    if (orders.length > 0) {
      const local = (await db.orders(companyId, { from, limit: 1000 })) as { orders?: { id: string }[] };
      fresh = unseenOrders(orders, new Set((local.orders ?? []).map(o => o.id)));
    }
    if (fresh.length === 0 && shut.length === 0) return 0;
    await db.putOrders(companyId, [...fresh, ...shut]);
    return fresh.length + shut.length;
  } catch {
    // The next tick, or the sweep, will carry it.
    return 0;
  }
}

export interface SyncOutcome {
  ok: boolean;
  steps: StepProgress[];
}

// ── Only what changed ────────────────────────────────────────────────────────
//
// The five-minute sweep re-downloaded the whole restaurant — menu, room, staff,
// couriers, 200 orders with their dishes — whether or not anything had changed,
// and on most ticks nothing had. With the signal up the sweep fetches only the
// parts a signal named since the last one.

/** Which steps a signal makes stale. Readiness and tickets have their own fast paths. */
const STEPS_FOR: Record<TillSignal, StepId[]> = {
  menu: ["menu", "categories", "modifiers", "stations", "tables", "staff", "couriers", "settings", "images"],
  orders: ["orders", "couriers"],
  shift: ["shift"],
  ready: [],
  print: [],
};

/** A whole sweep this often regardless, in case a message was lost on the way. */
export const FULL_PULL_EVERY_MS = 30 * 60_000;

/**
 * What the next sweep should fetch: everything, or only the steps named.
 *
 * Everything when there is no signal to trust — the socket is down, it came up
 * after the last whole sweep (anything said while it was down is lost), or the
 * half hour is up.
 */
export function planPull(s: {
  signalUp: boolean;
  upSince: number;
  lastFullAt: number;
  now: number;
  heard: Iterable<TillSignal>;
}): "all" | Set<StepId> {
  if (!s.signalUp || s.lastFullAt === 0 || s.upSince > s.lastFullAt) return "all";
  if (s.now - s.lastFullAt >= FULL_PULL_EVERY_MS) return "all";
  const only = new Set<StepId>();
  for (const kind of s.heard) for (const id of STEPS_FOR[kind] ?? []) only.add(id);
  return only;
}

// When this machine last finished a whole sweep with every step done.
let lastFullAt = 0;

/**
 * The timer's sweep: the parts a signal named, or everything when planPull
 * says so. `ran` is false when there was nothing to fetch.
 */
export async function pullChanged(
  companyId: string,
  heard: Iterable<TillSignal>,
  signalUp: boolean,
  upSince: number,
): Promise<{ ok: boolean; ran: boolean }> {
  const plan = planPull({ signalUp, upSince, lastFullAt, now: Date.now(), heard });
  if (plan !== "all" && plan.size === 0) return { ok: true, ran: false };
  const { ok } = await pullAll(companyId, undefined, plan === "all" ? undefined : plan);
  return { ok, ran: true };
}

/**
 * Pull everything this restaurant needs onto the machine.
 *
 * Steps are independent, so one failure does not abandon the rest — a till with
 * its menu and its room but no shift is far more use than a till with nothing.
 * The caller sees which step failed and can run this again; each step replaces
 * its own table, so running it twice is not a problem.
 */
export async function pullAll(
  companyId: string,
  onProgress?: (steps: StepProgress[]) => void,
  only?: Set<StepId>,
): Promise<SyncOutcome> {
  const db = till();
  if (!db) return { ok: false, steps: [] };

  // store.ts scopes its writes by this; its reads go through RLS either way,
  // but an unset context is a bug waiting to pick the wrong company.
  setCompanyContext(companyId);

  const startedAt = Date.now();
  const chosen = only ? STEPS.filter(s => only.has(s.id)) : STEPS;
  const steps: StepProgress[] = chosen.map(s => ({ id: s.id, label: s.label, state: "pending" }));
  const report = () => onProgress?.(steps.map(s => ({ ...s })));
  report();

  for (const [i, step] of chosen.entries()) {
    steps[i].state = "running";
    report();
    try {
      steps[i].count = await step.run(companyId, db);
      steps[i].state = "done";
    } catch (e) {
      steps[i].state = "failed";
      steps[i].error = e instanceof Error ? e.message : String(e);
    }
    report();
  }

  const ok = steps.every(s => s.state === "done");
  if (ok && !only) lastFullAt = startedAt;
  return { ok, steps };
}

/** Has this machine ever been filled for this company? */
export async function hasLocalData(companyId: string): Promise<boolean> {
  const db = till();
  if (!db) return false;
  try {
    const menu = (await db.menu(companyId)) as { items?: unknown[] };
    return (menu.items?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

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
import type { MenuItem, ModifierGroup } from "@/types";
import type { PosNative, TillSettings } from "./desktopPrint";
import { cacheImages } from "./till-image";

function till(): NonNullable<PosNative["till"]> | null {
  if (typeof window === "undefined") return null;
  return window.posNative?.till ?? null;
}

/** How many orders a fresh machine pulls down. The room, not the archive. */
const ORDER_WINDOW = 200;

export type StepId =
  | "menu" | "categories" | "modifiers" | "stations"
  | "tables" | "staff" | "orders" | "settings" | "shift" | "images";

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
      await replace(db, "halls", companyId, halls ?? []);
      return replace(db, "tables", companyId, tables ?? [], true);
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
    id: "orders",
    label: "Açıq sifarişlər",
    run: async (companyId, db) => {
      const { orders } = await serverRead<{ orders: unknown[] }>(
        db, "public-orders", companyId, { limit: String(ORDER_WINDOW) },
      );
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
      const { shift } = await serverRead<{ shift: unknown | null }>(db, "public-shift", companyId);
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

export interface SyncOutcome {
  ok: boolean;
  steps: StepProgress[];
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
): Promise<SyncOutcome> {
  const db = till();
  if (!db) return { ok: false, steps: [] };

  // store.ts scopes its writes by this; its reads go through RLS either way,
  // but an unset context is a bug waiting to pick the wrong company.
  setCompanyContext(companyId);

  const steps = stepList();
  const report = () => onProgress?.(steps.map(s => ({ ...s })));
  report();

  for (const [i, step] of STEPS.entries()) {
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

  return { ok: steps.every(s => s.state === "done"), steps };
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

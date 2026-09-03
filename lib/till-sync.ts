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
// The queries are the ones lib/store.ts already makes, under the waiter's own
// session and RLS. Nothing here holds a key, and nothing here is allowed to
// reach another company's data: that is enforced by the database, not by this
// file remembering to filter.

import {
  fetchMenu, fetchCategories, fetchTables, fetchHalls, fetchModifierGroups,
  fetchStations, fetchStaff, fetchOrders, fetchStationReady, fetchOpenShift,
  setCompanyContext,
} from "@/lib/store";
import type { MenuItem, ModifierGroup } from "@/types";
import type { PosNative } from "./desktopPrint";
import { cacheImages } from "./till-image";

function till(): NonNullable<PosNative["till"]> | null {
  if (typeof window === "undefined") return null;
  return window.posNative?.till ?? null;
}

// Every read below must go past the local copy to Supabase — this is the code
// that writes that copy, and a read served from it would sync the till with
// itself and call the result success.
const SERVER = { server: true } as const;

/** How many orders a fresh machine pulls down. The room, not the archive. */
const ORDER_WINDOW = 200;

export type StepId =
  | "menu" | "categories" | "modifiers" | "stations"
  | "tables" | "staff" | "orders" | "shift" | "images";

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
    run: async (companyId, db) => replace(db, "menu_items", companyId, await fetchMenu(SERVER), true),
  },
  {
    id: "categories",
    label: "Kateqoriyalar",
    run: async (companyId, db) => replace(db, "categories", companyId, await fetchCategories(SERVER), true),
  },
  {
    id: "modifiers",
    label: "Əlavələr",
    run: async (companyId, db) => replace(db, "modifier_groups", companyId, await fetchModifierGroups(SERVER)),
  },
  {
    id: "stations",
    label: "Sexlər",
    run: async (companyId, db) => replace(db, "stations", companyId, await fetchStations(SERVER)),
  },
  {
    id: "tables",
    label: "Masalar",
    run: async (companyId, db) => {
      // Halls before tables: a table carries its hall, and a screen that drew
      // the room before it knew the halls would put every table in one place.
      await replace(db, "halls", companyId, await fetchHalls(SERVER));
      return replace(db, "tables", companyId, await fetchTables(SERVER), true);
    },
  },
  {
    id: "staff",
    label: "İşçilər",
    run: async (companyId, db) => replace(db, "staff", companyId, await fetchStaff(SERVER)),
  },
  {
    id: "orders",
    label: "Açıq sifarişlər",
    run: async (companyId, db) => {
      const orders = await fetchOrders({ limit: ORDER_WINDOW, ...SERVER });
      await db.putOrders(companyId, orders);
      const ready = await fetchStationReady(undefined, SERVER);
      await db.putStationReady(companyId, ready);
      return orders.length;
    },
  },
  {
    id: "shift",
    label: "Növbə",
    run: async (companyId, db) => {
      const shift = await fetchOpenShift(SERVER);
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

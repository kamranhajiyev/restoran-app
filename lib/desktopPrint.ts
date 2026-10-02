// Kitchen printing, driven by the POS itself.
//
// The old design was a separate program (agent/) on the restaurant's network
// holding a service-role key. That key bypasses every RLS policy for every
// company, so it could never be shipped to a customer's machine. Here the
// desktop shell *is* the POS: it is already signed in as a waiter, so it claims
// only its own restaurant's tickets, and the machine-specific part — putting
// bytes on a socket — is the one thing it asks the native side to do.
//
// Runs only inside the Electron shell. In a plain browser posNative is absent
// and every entry point below is a no-op, so the same bundle is safe on the
// tablets and phones that will never see a printer.

import { supabase } from './supabase';
import { type TicketPayload } from './escpos';
import { buildStationTicketRaster } from './station-ticket';
import { tillPost } from './till-write';
import { tableTitle } from './order-place';
import { resolveStationId } from './stations';
import { isUsbPrinter } from './station-printer';
import { printRawToUsb } from './printer';
import type { MenuItem, OrderItem, Station } from '@/types';

/**
 * The switches an owner flips in the admin panel, as the till sees them.
 *
 * Kept on the machine rather than read from the companies row, which RLS will
 * not show a terminal that has no session — see app/api/public-settings.
 */
export interface TillSettings {
  tablesEnabled: boolean;
  deliveryEnabled: boolean;
  kassaEnabled: boolean;
  printReceipt: boolean;
  soundEnabled: boolean;
  menuOnly: boolean;
  logoUrl: string | null;
  brandColor: string | null;
  /** Business-day settings. Missing on a till that pulled before they existed. */
  timezone?: string | null;
  workOpen?: string | null;
  workClose?: string | null;
}

/** The till's local database, present only in a build that ships the app. */
export interface TillDb {
  /** The site whose /api routes the outbox replays against. */
  origin(): Promise<{ origin: string }>;
  /** The terminal link this machine was set up with, as JSON. See lib/terminal-link.ts. */
  link(): Promise<{ link: string | null }>;
  setLink(value: string | null): Promise<unknown>;
  /** Pull menu photographs onto the disk so they render offline. See lib/till-image.ts. */
  cacheImages(urls: string[]): Promise<{ cached: number }>;
  /** The company's on/off switches, as last pulled. See app/api/public-settings. */
  settings(companyId: string): Promise<{ settings: TillSettings | null }>;
  putSettings(companyId: string, settings: TillSettings): Promise<unknown>;
  /**
   * A request to the site, made by the main process.
   *
   * The page is served from app://till, so a fetch to possiblle.com is
   * cross-origin and the browser refuses it before it leaves. This is the only
   * way out; see the handler in electron/till-ipc.ts.
   */
  api(
    path: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<{ ok: boolean; status: number; body: string }>;
  menu(companyId: string): Promise<unknown>;
  categories(companyId: string): Promise<unknown>;
  tables(companyId: string): Promise<unknown>;
  staff(companyId: string): Promise<unknown>;
  couriers(companyId: string): Promise<unknown>;
  modifiers(companyId: string): Promise<unknown>;
  stations(companyId: string): Promise<unknown>;
  nextOrderNumber(companyId: string): Promise<{ orderNumber: number }>;
  stationReady(companyId: string): Promise<unknown>;
  orders(companyId: string, opts?: unknown): Promise<unknown>;
  shift(companyId: string): Promise<unknown>;
  shiftSales(companyId: string, openedAt: string): Promise<unknown>;
  /** Courier settlements in [from, to), split nağd/kart. */
  courierCollections(companyId: string, from: string, to: string): Promise<unknown>;

  putReference(table: string, companyId: string, rows: unknown): Promise<unknown>;
  putOrders(companyId: string, orders: unknown): Promise<unknown>;
  putStationReady(companyId: string, rows: unknown): Promise<unknown>;
  putShift(companyId: string, shift: unknown): Promise<unknown>;

  /** Apply one write locally and record it for Supabase. See lib/till-write.ts. */
  write(id: string, kind: string, body: unknown, companyId: string): Promise<{ ok: boolean; error?: string }>;
  outbox(): Promise<{ pending: number }>;
  /** Oldest first — the order Supabase has to see them in. */
  outboxList(): Promise<{ entries: OutboxEntry[] }>;
  outboxDrop(id: string): Promise<unknown>;
  outboxAttempted(id: string): Promise<unknown>;
}

/** One write the till has made that Supabase has not seen. */
export interface OutboxEntry {
  id: string;
  seq: number;
  /** The API route that will replay it, or a `supabase:` marker. */
  kind: string;
  body: unknown;
  companyId: string | null;
  queuedAt: string;
  attempts: number;
}

export interface PosNative {
  isDesktop: true;
  print(ip: string, port: number, bytes: Uint8Array, timeoutMs?: number): Promise<void>;
  /** Network printers answering on port 9100. Absent in installers before 0.3.7. */
  scanPrinters?(): Promise<string[]>;
  // Absent when the shell was pointed at a website with --url=: that build is
  // the web app in a window and still reads through the API routes.
  till?: TillDb;
  // Absent in installers built before the updater existed.
  update?: {
    status(): Promise<DesktopUpdate | null>;
    onReady(cb: (status: DesktopUpdate) => void): () => void;
    install(): Promise<void>;
  };
}

/** A downloaded update. `required` when it was already waiting as the app opened. */
export interface DesktopUpdate {
  version: string;
  required: boolean;
}

declare global {
  interface Window {
    posNative?: PosNative;
  }
}

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && window.posNative?.isDesktop === true;
}

const MAX_ATTEMPTS = 5;
const POLL_MS = 15_000;   // safety net under the realtime push
const LINK_POLL_MS = 4_000; // a linked till has no push, so this is how tickets arrive
const CLAIM_LIMIT = 10;

interface ClaimedJob {
  id: string;
  station_id: string | null;
  order_id: string;
  kind: string;
  payload: TicketPayload;
  attempts: number;
}

type StationPrinter = { ip: string | null; port: number; name: string };
type TableName = { id: number; name: string };

type Outcome =
  | { result: 'printed' }
  | { result: 'release' }
  | { result: 'failed'; attempts: number; error: string; giveUp: boolean };

/**
 * Who this till is to the server when it collects tickets.
 *
 * A signed-in till claims under its session, through RLS. A till opened with
 * only its terminal link has no session — RLS hands it nothing, and its sexes
 * never printed — so it goes through token-gated routes instead.
 */
export type PrintAuth =
  | { kind: 'session'; companyId: string }
  | { kind: 'link'; companyId: string; token: string };

interface JobSource {
  claim(): Promise<ClaimedJob[] | null>;
  stations(): Promise<Map<string, StationPrinter>>;
  /** Table names, for putting on the ticket in place of the bare id. */
  tables(): Promise<TableName[]>;
  report(id: string, outcome: Outcome): Promise<void>;
}

const sessionSource: JobSource = {
  async claim() {
    const { data, error } = await supabase.rpc('claim_print_jobs', { p_limit: CLAIM_LIMIT });
    if (error) { console.error('[print] claim', error.message); return null; }
    return (data ?? []) as ClaimedJob[];
  },
  async stations() {
    const { data } = await supabase.from('stations').select('id, name, printer_ip, printer_port');
    const next = new Map<string, StationPrinter>();
    for (const s of data ?? []) {
      next.set(s.id as string, {
        ip: (s.printer_ip as string | null) ?? null,
        port: (s.printer_port as number | null) ?? 9100,
        name: s.name as string,
      });
    }
    return next;
  },
  async tables() {
    const { data } = await supabase.from('restaurant_tables').select('id, name');
    return (data ?? []) as TableName[];
  },
  async report(id, outcome) {
    await supabase.from('print_jobs').update(
      outcome.result === 'printed'
        ? { status: 'printed', printed_at: new Date().toISOString(), error: null }
        : outcome.result === 'release'
          ? { status: 'pending', claimed_at: null }
          : {
              status: outcome.giveUp ? 'failed' : 'pending',
              claimed_at: null,
              attempts: outcome.attempts,
              error: outcome.error,
            },
    ).eq('id', id);
  },
};

function linkSource(companyId: string, token: string): JobSource {
  return {
    async claim() {
      const res = await tillPost<{ ok: boolean; jobs?: ClaimedJob[]; error?: string }>(
        '/api/claim-print-jobs', { companyId, token, limit: CLAIM_LIMIT });
      if (!res.ok) { console.error('[print] claim', res.error); return null; }
      return res.jobs ?? [];
    },
    async stations() {
      const next = new Map<string, StationPrinter>();
      for (const s of await fetchStationPrinters(companyId)) {
        next.set(s.id, { ip: s.printerIp, port: s.printerPort, name: s.name });
      }
      return next;
    },
    async tables() {
      const till = window.posNative?.till;
      const path = `/api/public-tables?companyId=${encodeURIComponent(companyId)}`;
      try {
        const body = till ? JSON.parse((await till.api(path)).body) : await (await fetch(path)).json();
        return ((body as { tables?: TableName[] }).tables ?? []);
      } catch {
        return [];
      }
    },
    async report(id, outcome) {
      await tillPost('/api/report-print-job', { companyId, token, id, outcome });
    },
  };
}

export interface StationPrinterRow { id: string; name: string; printerIp: string | null; printerPort: number }

/** The sexes and their printers, read without a session. */
export async function fetchStationPrinters(companyId: string): Promise<StationPrinterRow[]> {
  const till = window.posNative?.till;
  const path = `/api/public-stations?companyId=${encodeURIComponent(companyId)}`;
  try {
    const body = till
      ? JSON.parse((await till.api(path)).body)
      : await (await fetch(path)).json();
    return ((body as { stations?: StationPrinterRow[] }).stations ?? []);
  } catch {
    return [];
  }
}

/** Set one sex's printer IP from the till. null clears it. */
export async function saveStationPrinter(
  companyId: string, token: string, stationId: string, ip: string | null,
): Promise<boolean> {
  const res = await tillPost<{ ok: boolean }>('/api/update-station-printer', { companyId, token, stationId, ip });
  if (res.ok) stationCache = null;
  return res.ok;
}

let source: JobSource = sessionSource;

// Station rows change rarely, but an IP corrected mid-service must take effect
// without restarting the app — hence a short-lived cache rather than a load
// once at startup.
let stationCache: Map<string, StationPrinter> | null = null;
let stationCacheAt = 0;

async function stations() {
  if (stationCache && Date.now() - stationCacheAt < 60_000) return stationCache;
  stationCache = await source.stations();
  stationCacheAt = Date.now();
  return stationCache;
}

// Same short life as the stations: a table renamed mid-service shows up on the
// next ticket without a restart.
let tableCache: TableName[] | null = null;
let tableCacheAt = 0;

async function tables() {
  if (tableCache && Date.now() - tableCacheAt < 60_000) return tableCache;
  tableCache = await source.tables();
  tableCacheAt = Date.now();
  return tableCache;
}

async function runJob(job: ClaimedJob): Promise<void> {
  // Back into the queue, untouched, when this machine cannot print the job for
  // a reason that is nobody's fault and costs no attempt.
  const native = window.posNative;
  if (!native) return source.report(job.id, { result: 'release' });

  const station = job.station_id ? (await stations()).get(job.station_id) : undefined;

  // No printer configured for this station yet. The ticket is not lost — it
  // prints the moment an IP is set, and costs no attempt in the meantime.
  if (!station?.ip) return source.report(job.id, { result: 'release' });

  try {
    const known = await tables();
    await printTo(native, station.ip, station.port,
      buildStationTicketRaster(job.payload, id => tableTitle(known, id)));
    await source.report(job.id, { result: 'printed' });
  } catch (err) {
    const attempts = job.attempts + 1;
    const message = err instanceof Error ? err.message : String(err);
    // Five refusals and the seller screen shows a red badge on the order, so a
    // ticket that never came out is visible to the waiter instead of silently
    // lost. Short of that it goes back in the queue and the next poll retries.
    await source.report(job.id, {
      result: 'failed', attempts, error: message, giveUp: attempts >= MAX_ATTEMPTS,
    });
    console.error(`[print] ${job.kind} → ${station.name}: ${message}`);
  }
}

// ── Printing at the till ──────────────────────────────────────────────────────
// The queue above costs 5-10 seconds a ticket: the order has to reach Supabase,
// the trigger has to fire, and the till has to hear about it and claim it back.
// The till already has everything a ticket needs, and the printer is on its own
// network, so for a new order or an append it prints first and writes after.
//
// Each line that printed carries printedStationId, and the insert trigger
// records that station's job as already printed instead of queueing it (see
// 20261002_till_printed_tickets.sql). A station that did not print — no IP,
// printer off, unplugged — carries nothing, and its ticket goes through the
// queue exactly as before. So the worst a failure here costs is the old delay.
//
// Cancels, removals and table moves are untouched: they still come from the
// triggers, through the queue.

// Long enough for a printer on the LAN to answer, short enough that a waiter
// standing at a till whose kitchen printer is off is not kept waiting long.
const LOCAL_PRINT_MS = 1_500;

export interface KitchenTicket {
  companyId: string;
  kind: 'new' | 'append';
  orderNumber: number;
  table: number | null;
  courier: string | null;
  waiter: string | null;
  note: string | null;
  items: OrderItem[];
  menu: MenuItem[];
  tableName: (id: number) => string;
}

/** The number this till's database will give the next order, or null off the desktop. */
export async function nextLocalOrderNumber(companyId: string): Promise<number | null> {
  const till = window.posNative?.till;
  if (!till?.nextOrderNumber) return null;
  try {
    const { orderNumber } = await till.nextOrderNumber(companyId);
    return Number.isInteger(orderNumber) && orderNumber > 0 ? orderNumber : null;
  } catch {
    return null;
  }
}

/**
 * Print a new order's (or an append's) kitchen tickets now, from the till.
 *
 * Returns the items with printedStationId set on every line whose ticket came
 * out. Never throws: anything that goes wrong leaves the line unmarked, and the
 * queue prints it.
 */
export async function printKitchenNow(t: KitchenTicket): Promise<OrderItem[]> {
  const native = window.posNative;
  if (!native?.till) return t.items;

  let stations: Station[];
  try {
    stations = ((await native.till.stations(t.companyId)) as { stations?: Station[] }).stations ?? [];
  } catch {
    return t.items;
  }
  if (stations.length === 0) return t.items;

  // Same split as the trigger: a dish with no station of its own goes to the
  // first one.
  const menuById = new Map(t.menu.map(m => [String(m.id), m]));
  const groups = new Map<string, number[]>();
  t.items.forEach((oi, i) => {
    if (oi.noPrint || oi.removedAt) return;
    const id = resolveStationId(menuById.get(String(oi.menuItem.id))?.stationId, stations);
    if (!id) return;
    groups.set(id, [...(groups.get(id) ?? []), i]);
  });

  const printed = new Map<number, string>();
  const at = new Date().toISOString();
  // One at a time: two stations often share one printer, and two tickets on
  // the same socket at once come out as one unreadable slip.
  for (const [stationId, idx] of groups) {
    const station = stations.find(s => s.id === stationId);
    if (!station?.printerIp) continue;
    const payload: TicketPayload = {
      kind: t.kind,
      station: station.name,
      orderNumber: t.orderNumber,
      table: t.table,
      courier: t.courier,
      waiter: t.waiter,
      note: t.note,
      at,
      items: idx
        .map(i => ({ name: t.items[i].menuItem.name, qty: t.items[i].quantity, modifiers: t.items[i].modifiers ?? null }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
    try {
      await printTo(native, station.printerIp, station.printerPort ?? 9100,
        buildStationTicketRaster(payload, t.tableName), LOCAL_PRINT_MS);
      for (const i of idx) printed.set(i, stationId);
    } catch (err) {
      console.error(`[print] till → ${station.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return t.items.map((oi, i) => printed.has(i) ? { ...oi, printedStationId: printed.get(i) } : oi);
}

export interface NoteTicket {
  companyId: string;
  orderNumber: number;
  table: number | null;
  courier: string | null;
  waiter: string | null;
  note: string;
  // Every line the order has had, removed ones included: a station that printed
  // a dish since taken off still holds the order's ticket.
  items: OrderItem[];
  menu: MenuItem[];
  tableName: (id: number) => string;
}

/**
 * Print a QEYD slip — the note alone — at the stations holding this order's
 * ticket, or the first station if nothing was sent yet. The same choice
 * enqueue_note_ticket makes on the server.
 *
 * Returns the stations it came out at, for the server to record as printed.
 * Never throws: a station that did not print gets it through the queue.
 */
export async function printNoteNow(t: NoteTicket): Promise<string[]> {
  const native = window.posNative;
  if (!native?.till) return [];

  let stations: Station[];
  try {
    stations = ((await native.till.stations(t.companyId)) as { stations?: Station[] }).stations ?? [];
  } catch {
    return [];
  }
  if (stations.length === 0) return [];

  const menuById = new Map(t.menu.map(m => [String(m.id), m]));
  const ids = new Set<string>();
  for (const oi of t.items) {
    if (oi.noPrint) continue;
    const id = resolveStationId(menuById.get(String(oi.menuItem.id))?.stationId, stations);
    if (id) ids.add(id);
  }
  if (ids.size === 0) ids.add(stations[0].id);

  const printed: string[] = [];
  const at = new Date().toISOString();
  for (const stationId of ids) {
    const station = stations.find(s => s.id === stationId);
    if (!station?.printerIp) continue;
    const payload: TicketPayload = {
      kind: 'note', station: station.name, orderNumber: t.orderNumber,
      table: t.table, courier: t.courier, waiter: t.waiter, note: t.note, at, items: [],
    };
    try {
      await printTo(native, station.printerIp, station.printerPort ?? 9100,
        buildStationTicketRaster(payload, t.tableName), LOCAL_PRINT_MS);
      printed.push(stationId);
    } catch (err) {
      console.error(`[print] till → ${station.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return printed;
}

/** A sex's ticket to wherever its printer is: the network, or this till's USB printer. */
function printTo(native: PosNative, ip: string, port: number, bytes: Uint8Array, timeoutMs?: number): Promise<void> {
  return isUsbPrinter(ip) ? printRawToUsb(bytes) : native.print(ip, port, bytes, timeoutMs);
}

let draining = false;
// A push that lands mid-drain used to be dropped, and its ticket waited for the
// 15-second poll. Now it just asks the running drain to go round once more.
let drainAgain = false;
// Only while startKitchenPrinting is running: the seller page kicks the queue
// after every send, and a till that was refused (another company's session)
// must not start claiming through the default source.
let printingActive = false;

export async function drainPrintQueue(): Promise<void> {
  if (!isDesktop() || !printingActive) return;
  if (draining) { drainAgain = true; return; }
  draining = true;
  try {
    do {
      drainAgain = false;
      const jobs = await source.claim();
      // Sequential, not Promise.all: one printer, and two tickets interleaved on
      // the same socket come out as one unreadable slip.
      for (const job of jobs ?? []) {
        await runJob(job);
      }
    } while (drainAgain);
  } finally {
    draining = false;
  }
}

// Call once from the seller screen. Returns the teardown.
export function startKitchenPrinting(auth: PrintAuth): () => void {
  if (!isDesktop()) return () => {};

  source = auth.kind === 'session' ? sessionSource : linkSource(auth.companyId, auth.token);
  stationCache = null;
  tableCache = null;
  printingActive = true;

  void drainPrintQueue();

  // Realtime only reaches a signed-in till: print_jobs is behind RLS, and a
  // linked till's socket would sit there hearing nothing. It polls faster instead.
  const channel = auth.kind === 'session'
    ? supabase
        .channel('desktop-print-jobs')
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'print_jobs', filter: `company_id=eq.${auth.companyId}` },
          () => void drainPrintQueue())
        .subscribe()
    : null;

  // Realtime sockets die quietly on sleep and Wi-Fi drops. Polling is the floor
  // under that: a ticket may be late, but it is never lost.
  const timer = setInterval(() => void drainPrintQueue(), channel ? POLL_MS : LINK_POLL_MS);

  return () => {
    printingActive = false;
    clearInterval(timer);
    if (channel) void supabase.removeChannel(channel);
  };
}

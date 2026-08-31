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
import { buildStationTicket, type TicketPayload } from './escpos';

export interface PosNative {
  isDesktop: true;
  print(ip: string, port: number, bytes: Uint8Array): Promise<void>;
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
const CLAIM_LIMIT = 10;

interface ClaimedJob {
  id: string;
  station_id: string | null;
  order_id: string;
  kind: string;
  payload: TicketPayload;
  attempts: number;
}

// Station rows change rarely, but an IP corrected mid-service must take effect
// without restarting the app — hence a short-lived cache rather than a load
// once at startup.
let stationCache: Map<string, { ip: string | null; port: number; name: string }> | null = null;
let stationCacheAt = 0;

async function stations() {
  if (stationCache && Date.now() - stationCacheAt < 60_000) return stationCache;
  const { data } = await supabase.from('stations').select('id, name, printer_ip, printer_port');
  const next = new Map<string, { ip: string | null; port: number; name: string }>();
  for (const s of data ?? []) {
    next.set(s.id as string, {
      ip: (s.printer_ip as string | null) ?? null,
      port: (s.printer_port as number | null) ?? 9100,
      name: s.name as string,
    });
  }
  stationCache = next;
  stationCacheAt = Date.now();
  return next;
}

// Back into the queue, untouched. Used when this machine cannot print the job
// for a reason that is nobody's fault and costs no attempt — no IP configured
// yet, or the station row is gone.
async function release(id: string): Promise<void> {
  await supabase.from('print_jobs')
    .update({ status: 'pending', claimed_at: null })
    .eq('id', id);
}

async function runJob(job: ClaimedJob): Promise<void> {
  const native = window.posNative;
  if (!native) return release(job.id);

  const station = job.station_id ? (await stations()).get(job.station_id) : undefined;

  // No printer configured for this station yet. The ticket is not lost — it
  // prints the moment an IP is set, and costs no attempt in the meantime.
  if (!station?.ip) return release(job.id);

  try {
    await native.print(station.ip, station.port, buildStationTicket(job.payload));
    await supabase.from('print_jobs')
      .update({ status: 'printed', printed_at: new Date().toISOString(), error: null })
      .eq('id', job.id);
  } catch (err) {
    const attempts = job.attempts + 1;
    const message = err instanceof Error ? err.message : String(err);
    // Five refusals and the seller screen shows a red badge on the order, so a
    // ticket that never came out is visible to the waiter instead of silently
    // lost. Short of that it goes back in the queue and the next poll retries.
    await supabase.from('print_jobs')
      .update({
        status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        claimed_at: null,
        attempts,
        error: message,
      })
      .eq('id', job.id);
    console.error(`[print] ${job.kind} → ${station.name}: ${message}`);
  }
}

let draining = false;

export async function drainPrintQueue(): Promise<void> {
  if (!isDesktop() || draining) return;
  draining = true;
  try {
    const { data, error } = await supabase.rpc('claim_print_jobs', { p_limit: CLAIM_LIMIT });
    if (error) { console.error('[print] claim', error.message); return; }
    // Sequential, not Promise.all: one printer, and two tickets interleaved on
    // the same socket come out as one unreadable slip.
    for (const job of (data ?? []) as ClaimedJob[]) {
      await runJob(job);
    }
  } finally {
    draining = false;
  }
}

// Call once from the seller screen. Returns the teardown.
export function startKitchenPrinting(companyId: string): () => void {
  if (!isDesktop()) return () => {};

  void drainPrintQueue();

  const channel = supabase
    .channel('desktop-print-jobs')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'print_jobs', filter: `company_id=eq.${companyId}` },
      () => void drainPrintQueue())
    .subscribe();

  // Realtime sockets die quietly on sleep and Wi-Fi drops. Polling is the floor
  // under that: a ticket may be late, but it is never lost.
  const timer = setInterval(() => void drainPrintQueue(), POLL_MS);

  return () => {
    clearInterval(timer);
    void supabase.removeChannel(channel);
  };
}

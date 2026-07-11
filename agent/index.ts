// Print agent — runs on the register PC, inside the restaurant's network.
//
// Why this exists: the app runs in the cloud and cannot reach 192.168.x.x, and
// a browser cannot open a raw TCP socket. So something on the LAN has to carry
// tickets to the printers. This is that something.
//
//   waiter presses "Sifariş ver"
//     → DB trigger splits the order by station, writes print_jobs rows
//     → this agent picks them up and sends each to its station's printer IP
//
// Run:  npm run agent

import net from 'node:net';
import { createClient } from '@supabase/supabase-js';
import { buildStationTicket, type TicketPayload } from '../lib/escpos';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const COMPANY_ID   = process.env.COMPANY_ID;

if (!SUPABASE_URL || !SERVICE_KEY || !COMPANY_ID) {
  console.error('Missing env. Copy agent/.env.example to .env and fill it in.');
  process.exit(1);
}

const MAX_ATTEMPTS = 5;
const POLL_MS      = 15_000;   // safety net under the realtime push
const CONNECT_MS   = 5_000;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

interface Job {
  id: string;
  station_id: string | null;
  order_id: string;
  kind: string;
  payload: TicketPayload;
  attempts: number;
}

const stationCache = new Map<string, { ip: string | null; port: number; name: string }>();

async function stationOf(id: string) {
  const hit = stationCache.get(id);
  if (hit) return hit;
  const { data } = await db.from('stations').select('name, printer_ip, printer_port').eq('id', id).single();
  if (!data) return null;
  const s = { ip: data.printer_ip, port: data.printer_port ?? 9100, name: data.name };
  stationCache.set(id, s);
  return s;
}
// Station edits are rare; drop the cache periodically so a changed IP is picked
// up without restarting the agent.
setInterval(() => stationCache.clear(), 60_000);

function sendToPrinter(ip: string, port: number, bytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const fail = (err: Error) => { socket.destroy(); reject(err); };

    socket.setTimeout(CONNECT_MS, () => fail(new Error(`timeout connecting to ${ip}:${port}`)));
    socket.once('error', fail);
    socket.connect(port, ip, () => {
      socket.write(Buffer.from(bytes), err => {
        if (err) return fail(err);
        // end() flushes; the printer closes its side once it has the bytes.
        socket.end(() => resolve());
      });
    });
  });
}

// A printer that is merely unplugged for a moment must not burn through all five
// attempts in five seconds and be declared dead. Wait longer after each failure.
const retryAt = new Map<string, number>();
const backoffMs = (attempts: number) => Math.min(2 ** attempts, 60) * 1000;   // 2s, 4s, 8s, 16s, 32s

async function runJob(job: Job): Promise<void> {
  const station = job.station_id ? await stationOf(job.station_id) : null;

  // No printer configured for this station yet. Leave the job pending rather
  // than failing it: the ticket is not lost, it prints as soon as an IP is set.
  if (!station?.ip) return;

  try {
    await sendToPrinter(station.ip, station.port, buildStationTicket(job.payload));
    await db.from('print_jobs')
      .update({ status: 'printed', printed_at: new Date().toISOString(), error: null })
      .eq('id', job.id);
    retryAt.delete(job.id);
    console.log(`✓ ${job.kind} → ${station.name} (order ${job.payload.orderNumber ?? '-'})`);
  } catch (err) {
    const attempts = job.attempts + 1;
    const msg = err instanceof Error ? err.message : String(err);
    const dead = attempts >= MAX_ATTEMPTS;
    await db.from('print_jobs')
      .update({ status: dead ? 'failed' : 'pending', attempts, error: msg })
      .eq('id', job.id);
    if (dead) retryAt.delete(job.id);
    else retryAt.set(job.id, Date.now() + backoffMs(attempts));
    // A failed job is surfaced on the seller screen — a ticket that quietly
    // vanishes is worse than no printer at all.
    console.error(`✗ ${job.kind} → ${station.name}: ${msg}${dead ? ' — GIVING UP' : ` (retry ${attempts}/${MAX_ATTEMPTS})`}`);
  }
}

let draining = false;

async function drain(): Promise<void> {
  // One drain at a time: two concurrent passes could claim the same job and
  // print it twice, and a cook can't tell a duplicate ticket from a real
  // second order.
  if (draining) return;
  draining = true;
  try {
    const { data, error } = await db
      .from('print_jobs')
      .select('id, station_id, order_id, kind, payload, attempts')
      .eq('company_id', COMPANY_ID)
      .eq('status', 'pending')
      .lt('attempts', MAX_ATTEMPTS)
      .order('created_at')
      .limit(50);

    if (error) { console.error('[queue]', error.message); return; }

    const now = Date.now();
    for (const job of (data ?? []) as Job[]) {
      if ((retryAt.get(job.id) ?? 0) > now) continue;   // still backing off
      await runJob(job);
    }
  } finally {
    draining = false;
  }
}

console.log(`Print agent up — company ${COMPANY_ID}`);
void drain();

db.channel('print-jobs')
  .on('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'print_jobs', filter: `company_id=eq.${COMPANY_ID}` },
    () => void drain())
  .subscribe(status => console.log(`realtime: ${status}`));

// The socket can die quietly (sleep, Wi-Fi drop). Polling is the floor under it.
setInterval(() => void drain(), POLL_MS);

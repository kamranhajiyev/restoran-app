// Finding the kitchen printers on the restaurant's network, so nobody has to
// read an IP off a printer's self-test slip and type it in.
//
// A network receipt printer takes raw ESC/POS on TCP port 9100. So: knock on
// 9100 at every address in this machine's own /24, all at once, and list who
// answers. Poster's Windows app finds them the same way. Only connected, never
// written to — nothing prints.
//
// Only the /24 the till sits in, whatever the real netmask: that is where a
// restaurant's printers are, and a /16 would be 65,000 knocks for nothing.

import net from 'node:net';
import os from 'node:os';

const PORT = 9100;
const KNOCK_MS = 1_200;

function knock(ip: string): Promise<boolean> {
  return new Promise(resolve => {
    const socket = new net.Socket();
    const done = (open: boolean) => { socket.destroy(); resolve(open); };
    socket.setTimeout(KNOCK_MS, () => done(false));
    socket.once('error', () => done(false));
    socket.connect(PORT, ip, () => done(true));
  });
}

/** This machine's private IPv4 addresses — the networks worth searching. */
function ownAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(a => a && a.family === 'IPv4' && !a.internal)
    .map(a => a!.address)
    // Private ranges only: a till on a public address is not on a restaurant LAN.
    .filter(ip => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip));
}

/** Addresses on this machine's network that answer on the printer port, in order. */
export async function scanPrinters(): Promise<string[]> {
  const own = ownAddresses();
  const prefixes = [...new Set(own.map(ip => ip.split('.').slice(0, 3).join('.')))];
  const candidates = prefixes.flatMap(p =>
    Array.from({ length: 254 }, (_, i) => `${p}.${i + 1}`)).filter(ip => !own.includes(ip));

  const open = await Promise.all(candidates.map(async ip => (await knock(ip)) ? ip : null));
  return open.filter((ip): ip is string => ip !== null);
}

// 2026-11-01: sending a ticket to a network printer (lib/tcp-print.ts) had no
// test. A printer that is off never answers; without the timeout the ticket
// looked as if it was still printing, and the kitchen never got it. Run against
// a pretend printer on this machine.

import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { sendToPrinter } from '@/lib/tcp-print';

const servers: net.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(s => new Promise(r => s.close(r))));
});

/** A pretend printer: keeps what it is sent; `silent` never reads or closes. */
function printer(silent = false): Promise<{ port: number; got: () => Buffer }> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    const server = net.createServer(socket => {
      if (silent) return;
      socket.on('data', c => chunks.push(c));
      socket.on('end', () => socket.end());
    });
    servers.push(server);
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: (server.address() as net.AddressInfo).port, got: () => Buffer.concat(chunks) });
    });
  });
}

describe('a network printer', () => {
  it('gets every byte of the ticket', async () => {
    const p = await printer();
    const ticket = new Uint8Array([0x1b, 0x40, 0x48, 0x69, 0x0a, 0x1d, 0x56, 0x00]);
    await sendToPrinter('127.0.0.1', p.port, ticket);
    await new Promise(r => setTimeout(r, 50));
    expect([...p.got()]).toEqual([...ticket]);
  });

  it('fails at once when nothing listens there', async () => {
    const p = await printer();
    const port = p.port;
    await new Promise(r => servers.pop()!.close(r));
    await expect(sendToPrinter('127.0.0.1', port, new Uint8Array([1]))).rejects.toThrow();
  });

  it('gives up after the timeout when the printer never answers, instead of hanging', async () => {
    // A non-routable address: the connection neither opens nor is refused.
    const started = Date.now();
    await expect(sendToPrinter('10.255.255.1', 9100, new Uint8Array([1]), 300)).rejects.toThrow(/timeout/);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

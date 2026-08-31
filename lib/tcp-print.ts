// Raw ESC/POS over TCP — the only thing a browser cannot do, and therefore the
// only reason the desktop shell exists at all.
//
// Node-only: it imports node:net, so nothing in app/ or components/ may import
// it. The Electron main process and agent/ both do.

import net from 'node:net';

const CONNECT_MS = 5_000;

export function sendToPrinter(
  ip: string,
  port: number,
  bytes: Uint8Array,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(err);
    };

    // A kitchen printer that is off does not refuse the connection, it simply
    // never answers. Without this the socket would hang until the OS gave up
    // minutes later, and the ticket would look like it was still printing.
    socket.setTimeout(CONNECT_MS, () => fail(new Error(`timeout connecting to ${ip}:${port}`)));
    socket.once('error', fail);
    socket.connect(port, ip, () => {
      socket.write(Buffer.from(bytes), err => {
        if (err) return fail(err);
        // end() flushes; the printer closes its side once it has the bytes.
        socket.end(() => {
          if (settled) return;
          settled = true;
          resolve();
        });
      });
    });
  });
}

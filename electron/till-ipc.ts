// What the till is allowed to ask the machine for.
//
// The list itself is lib/till-store/handlers.ts, shared with the Android app.
// Here each handler gets an IPC channel of its own name, 'till:<name>', which
// is what electron/preload.ts invokes.

import { ipcMain, net } from 'electron';
import { tillHandlers } from '../lib/till-store/handlers';
import { cacheImages } from './images';

export function registerTillHandlers(appUrl: string): void {
  const handlers = tillHandlers({
    appUrl,
    // The main process has no CORS rule, so the request is made here.
    fetch: async (url, init) => {
      const res = await net.fetch(url, init);
      return { ok: res.ok, status: res.status, body: await res.text() };
    },
    cacheImages,
  });

  for (const [name, handler] of Object.entries(handlers)) {
    ipcMain.handle(`till:${name}`, (_e, ...args: unknown[]) =>
      (handler as (...a: unknown[]) => unknown)(...args));
  }
}

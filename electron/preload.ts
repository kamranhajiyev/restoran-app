// The one bridge between the web page and the machine it runs on.
//
// Deliberately narrow: a function that puts bytes on a socket, and a fixed list
// of questions about this restaurant's own data. The page keeps deciding *what*
// to print and *who* is allowed to — this only carries the result to the
// printer — and it cannot ask the database anything the list below does not
// already name. Anything wider would be a hole in a window that has, in other
// builds, loaded a remote URL.

import { contextBridge, ipcRenderer } from 'electron';

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('posNative', {
  // Present only inside the desktop app. The web build checks for it to decide
  // whether this machine is the one that drives the kitchen printers.
  isDesktop: true,
  print: (ip: string, port: number, bytes: Uint8Array): Promise<void> =>
    ipcRenderer.invoke('printer:send', ip, port, bytes),

  // The local database. Absent when the shell is pointed at a remote site with
  // --url=, so lib/till-data.ts can fall back to the HTTP routes.
  till: {
    origin: () => invoke('till:origin'),
    // Which restaurant this machine was linked to, kept across restarts.
    link: () => invoke('till:link'),
    setLink: (value: string | null) => invoke('till:setLink', value),
    cacheImages: (urls: string[]) => invoke('till:cacheImages', urls),
    // The owner's on/off switches, kept so an outage still honours them.
    settings: (companyId: string) => invoke('till:settings', companyId),
    putSettings: (companyId: string, settings: unknown) => invoke('till:putSettings', companyId, settings),
    api: (path: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
      invoke('till:api', path, init),
    menu: (companyId: string) => invoke('till:menu', companyId),
    categories: (companyId: string) => invoke('till:categories', companyId),
    tables: (companyId: string) => invoke('till:tables', companyId),
    staff: (companyId: string) => invoke('till:staff', companyId),
    modifiers: (companyId: string) => invoke('till:modifiers', companyId),
    stations: (companyId: string) => invoke('till:stations', companyId),
    stationReady: (companyId: string) => invoke('till:stationReady', companyId),
    orders: (companyId: string, opts?: unknown) => invoke('till:orders', companyId, opts),
    shift: (companyId: string) => invoke('till:shift', companyId),
    shiftSales: (companyId: string, openedAt: string) => invoke('till:shiftSales', companyId, openedAt),

    putReference: (table: string, companyId: string, rows: unknown) =>
      invoke('till:putReference', table, companyId, rows),
    putOrders: (companyId: string, orders: unknown) => invoke('till:putOrders', companyId, orders),
    putStationReady: (companyId: string, rows: unknown) =>
      invoke('till:putStationReady', companyId, rows),
    putShift: (companyId: string, shift: unknown) => invoke('till:putShift', companyId, shift),

    // Everything the waiter does. Applied to the disk and recorded for Supabase
    // in one transaction; nothing here touches the network.
    write: (id: string, kind: string, body: unknown, companyId: string) =>
      invoke('till:write', id, kind, body, companyId),
    outbox: () => invoke('till:outbox'),

    // What is still waiting for Supabase, and how to retire an entry once the
    // page has managed to send it.
    outboxList: () => invoke('till:outboxList'),
    outboxDrop: (id: string) => invoke('till:outboxDrop', id),
    outboxAttempted: (id: string) => invoke('till:outboxAttempted', id),
  },
});

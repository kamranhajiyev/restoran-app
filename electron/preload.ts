// The one bridge between the web page and the machine it runs on.
//
// Deliberately tiny: a single function that puts bytes on a socket. The page
// keeps deciding *what* to print and *who* is allowed to — this only carries
// the result to the printer. Anything wider would be a hole in a window that
// loads a remote URL.

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('posNative', {
  // Present only inside the desktop app. The web build checks for it to decide
  // whether this machine is the one that drives the kitchen printers.
  isDesktop: true,
  print: (ip: string, port: number, bytes: Uint8Array): Promise<void> =>
    ipcRenderer.invoke('printer:send', ip, port, bytes),
});

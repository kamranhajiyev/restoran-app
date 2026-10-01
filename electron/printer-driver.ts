// Doing Zadig's job, so nobody has to.
//
// WebUSB can only open a device that runs on WinUSB, and Windows hands a receipt
// printer its own usbprint driver the moment it is plugged in. Until now that
// meant someone running Zadig on every till by hand — and again whenever Windows
// Update quietly put usbprint back, which shows up mid-service as a till that can
// no longer find its printer.
//
// So the app checks on start, and whenever the till goes looking for the printer.
// If the printer is on anything but WinUSB, it asks once, Windows asks for admin,
// and a copy of this same exe swaps the driver (libwdi, the library inside Zadig —
// built by scripts/build-winusb.mjs). Poster's Windows app does the same.
//
// Only ever the receipt printer's VID/PID: nothing else on the machine is
// touched, which is the one way Zadig in the wrong hands breaks a PC. A till
// already on WinUSB is left alone. Declining the prompt costs nothing — printing
// stays as it was and the app asks again next start.

import { app, BrowserWindow, dialog } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Xprinter XP-Q806K and XP-S200M both report this pair.
export const PRINTER_VID = 0x1fc9;
export const PRINTER_PID = 0x2016;

/** Started with this, the exe swaps the driver and exits instead of opening the till. */
const HELPER_FLAG = '--install-printer-driver';

// Windows' ERROR_CANCELLED: the admin prompt was answered "No".
const DECLINED = 1223;

interface UsbDevice { vid: number; pid: number; driver: string; composite: boolean; mi: number }
interface Wdi {
  listDevices(): UsbDevice[];
  associate(vid: number, pid: number, description: string, dir: string): void;
}

let wdi: Wdi | null | undefined;

/** The addon, or null where there is none: off Windows, from source, or an older build. */
function loadWdi(): Wdi | null {
  if (wdi !== undefined) return wdi;
  wdi = null;
  if (process.platform !== 'win32' || !app.isPackaged) return wdi;
  const file = path.join(process.resourcesPath, 'winusb', 'Generator.node');
  if (!fs.existsSync(file)) return wdi;
  try {
    const mod = { exports: {} };
    process.dlopen(mod, file);
    wdi = mod.exports as Wdi;
  } catch (err) {
    log(`load failed: ${String(err)}`);
  }
  return wdi;
}

// Kept on the machine: the elevated half has no console anyone can see, and
// "the printer never got its driver" is otherwise a support call with no clues.
function log(line: string): void {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'printer-driver.log'),
      `${new Date().toISOString()} ${line}\n`);
  } catch {
    // Nowhere to write. Nothing to do about it.
  }
}

export function isDriverHelper(): boolean {
  return process.argv.includes(HELPER_FLAG);
}

/** The elevated half. Exits with 0 when the printer is on WinUSB. */
export function runDriverHelper(): void {
  let code = 1;
  try {
    const lib = loadWdi();
    if (!lib) throw new Error('this build has no WinUSB installer');
    // A directory of its own: elevated, the working directory is System32.
    lib.associate(PRINTER_VID, PRINTER_PID, 'Receipt printer (Possiblle POS)',
      path.join(os.tmpdir(), 'possiblle-winusb'));
    log('driver installed');
    code = 0;
  } catch (err) {
    log(`install failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  app.exit(code);
}

/** Run this exe again as admin, in helper mode. Resolves with its exit code. */
function installElevated(): Promise<number> {
  const exe = process.execPath.replace(/'/g, "''");
  // Start-Process throws when the prompt is declined; without the catch that
  // would come back as success.
  const script = `try { $p = Start-Process -FilePath '${exe}' -ArgumentList '${HELPER_FLAG}' `
    + `-Verb RunAs -Wait -PassThru -ErrorAction Stop; exit $p.ExitCode } catch { exit ${DECLINED} }`;
  return new Promise(resolve => {
    const child = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true });
    child.on('error', err => { log(`powershell: ${err.message}`); resolve(1); });
    child.on('exit', code => resolve(code ?? 1));
  });
}

// 'settled' once the printer is on WinUSB, or once this run has asked and been
// refused or failed: one prompt per start, never one per pairing attempt.
let state: 'idle' | 'busy' | 'settled' = 'idle';

/** Put the receipt printer on WinUSB if it is plugged in and is not already. */
export async function ensurePrinterDriver(win: BrowserWindow | null): Promise<void> {
  if (state !== 'idle') return;
  const lib = loadWdi();
  if (!lib) return;

  let printer: UsbDevice | undefined;
  try {
    printer = lib.listDevices().find(d =>
      d.vid === PRINTER_VID && d.pid === PRINTER_PID && d.driver.toLowerCase() !== 'usbccgp');
  } catch (err) {
    log(`list failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  // Not plugged in. Checked again the next time the till looks for it.
  if (!printer) return;
  if (printer.driver.toLowerCase() === 'winusb') { state = 'settled'; return; }

  state = 'busy';
  log(`printer on "${printer.driver || 'no driver'}", installing WinUSB`);
  const parent = win && !win.isDestroyed() ? win : undefined;
  const show = (opts: Electron.MessageBoxOptions) =>
    parent ? dialog.showMessageBox(parent, opts) : dialog.showMessageBox(opts);

  // Said before Windows' own prompt, which on its own reads like something to refuse.
  await show({
    type: 'info',
    title: 'Possiblle POS',
    message: 'Çek yazıcısı üçün birdəfəlik quraşdırma',
    detail: 'Windows icazə soruşacaq — «Bəli» düyməsini basın.',
  });

  const code = await installElevated();
  state = 'settled';
  if (code === 0) {
    await show({ type: 'info', title: 'Possiblle POS', message: 'Çek yazıcısı hazırdır.' });
  } else if (code === DECLINED) {
    log('admin prompt declined');
  } else {
    log(`helper exited ${code}`);
    await show({
      type: 'warning',
      title: 'Possiblle POS',
      message: 'Çek yazıcısı quraşdırılmadı.',
      detail: 'Proqramı yenidən açanda bir daha cəhd ediləcək.',
    });
  }
}

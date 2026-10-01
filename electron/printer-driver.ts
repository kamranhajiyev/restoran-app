// Doing Zadig's job, so nobody has to.
//
// WebUSB can only open a device that runs on WinUSB, and Windows hands a receipt
// printer its own driver (usbprint, or the maker's — "Printer POS-80") the moment
// it is plugged in. Until now that meant someone running Zadig on every till by
// hand — and again whenever Windows Update quietly put the old driver back, which
// shows up mid-service as a till that can no longer find its printer.
//
// So the app checks on start, and whenever the till goes looking for the printer.
// If a receipt printer is on anything but WinUSB, it asks once, Windows asks for
// admin, and a copy of this same exe swaps the driver (libwdi, the library inside
// Zadig — built by scripts/build-winusb.mjs). Poster's Windows app does the same.
//
// Any receipt printer, not one model: whatever declares itself a USB printer
// (class 07), minus the office brands below, plus the Xprinter ID the tills
// started on. Never anything matched by vendor alone — the page's vendor filters
// would also catch a scale on an STMicro chip, and a scale on WinUSB stops
// weighing. That is the one way Zadig in the wrong hands breaks a PC. A printer
// already on WinUSB is left alone; declining the prompt costs nothing — printing
// stays as it was and the app asks again next start.

import { app, BrowserWindow, dialog } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Xprinter XP-Q806K and XP-S200M both report this pair. Known to work, so it
// counts whatever class it declares.
const XPRINTER = { vid: 0x1fc9, pid: 0x2016 };

// Printer-class devices that are not receipt printers: office and label printers
// that need their own driver to print at all. Poster's Windows app skips the same
// vendors. Star is here too — its receipt printers speak their own protocol, not
// the ESC/POS the till sends.
const OFFICE_VENDORS = new Set([
  0x03f0, // HP
  0x0482, // Kyocera
  0x04a9, // Canon
  0x04c5, // Fujitsu
  0x04e8, // Samsung
  0x04f9, // Brother
  0x0519, // Star Micronics
  0x0550, // Fuji Xerox
  0x05ca, // Ricoh
  0x08a6, // Toshiba TEC
  0x0924, // Xerox
  0x0a5f, // Zebra
]);

/** Started with this, the exe swaps the driver and exits instead of opening the till. */
const HELPER_FLAG = '--install-printer-driver=';

// Windows' ERROR_CANCELLED: the admin prompt was answered "No".
const DECLINED = 1223;

interface UsbDevice {
  vid: number;
  pid: number;
  driver: string;
  composite: boolean;
  mi: number;
  /** The first compatible ID, e.g. USB\COMPAT_VID_1FC9&Class_07&SubClass_01&Prot_02 */
  compatible: string;
}
interface Wdi {
  listDevices(): UsbDevice[];
  associate(vid: number, pid: number, mi: number, description: string, dir: string): void;
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

const hex = (n: number) => n.toString(16).padStart(4, '0');
const isXprinter = (vid: number, pid: number) => vid === XPRINTER.vid && pid === XPRINTER.pid;

function isPrinterEntry(d: UsbDevice): boolean {
  // The parent of a composite device; its printer interface is listed separately.
  if (d.driver.toLowerCase() === 'usbccgp') return false;
  if (OFFICE_VENDORS.has(d.vid)) return false;
  // libwdi keeps only the first compatible ID, which on Windows 10/11 is
  // usually USB\COMPAT_VID_xxxx&Class_07&… rather than USB\Class_07&….
  return isXprinter(d.vid, d.pid) || /[\\&]Class_07(&|$)/i.test(d.compatible);
}

// Listing walks every device on the machine. The permission check below runs on
// each navigator.usb.getDevices(), so the answer is kept for a few seconds.
let cached: { at: number; printers: UsbDevice[] } | null = null;

/** The receipt printers plugged in now, as libwdi sees them. Empty without the addon. */
function printers(): UsbDevice[] {
  if (cached && Date.now() - cached.at < 5_000) return cached.printers;
  const lib = loadWdi();
  let found: UsbDevice[] = [];
  if (lib) {
    try {
      found = lib.listDevices().filter(isPrinterEntry);
    } catch (err) {
      log(`list failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  cached = { at: Date.now(), printers: found };
  return found;
}

/**
 * Whether the till may drive this USB device as its receipt printer.
 *
 * Electron hands over only the device descriptor, and a printer usually declares
 * its class on the interface instead — hence libwdi's listing, where it exists.
 */
export function isReceiptPrinter(d: { vendorId: number; productId: number; deviceClass?: number }): boolean {
  if (OFFICE_VENDORS.has(d.vendorId)) return false;
  if (isXprinter(d.vendorId, d.productId) || d.deviceClass === 7) return true;
  return printers().some(p => p.vid === d.vendorId && p.pid === d.productId);
}

export function isDriverHelper(): boolean {
  return process.argv.some(a => a.startsWith(HELPER_FLAG));
}

/** The elevated half. Exits with 0 when every printer it was given is on WinUSB. */
export function runDriverHelper(): void {
  let code = 1;
  try {
    const lib = loadWdi();
    if (!lib) throw new Error('this build has no WinUSB installer');
    // vid:pid:mi,… — parsed strictly, since this runs as admin.
    const arg = process.argv.find(a => a.startsWith(HELPER_FLAG))!.slice(HELPER_FLAG.length);
    const targets = arg.split(',').map(t => {
      const m = /^([0-9a-f]{4}):([0-9a-f]{4}):(-1|\d{1,3})$/i.exec(t);
      if (!m) throw new Error(`bad target "${t}"`);
      return { vid: parseInt(m[1], 16), pid: parseInt(m[2], 16), mi: Number(m[3]) };
    });
    let failed = 0;
    for (const t of targets) {
      // A directory of its own: elevated, the working directory is System32.
      const dir = path.join(os.tmpdir(), 'possiblle-winusb', `${hex(t.vid)}-${hex(t.pid)}-${t.mi}`);
      try {
        lib.associate(t.vid, t.pid, t.mi, 'Receipt printer (Possiblle POS)', dir);
        log(`driver installed for ${hex(t.vid)}:${hex(t.pid)}`);
      } catch (err) {
        failed++;
        log(`install failed for ${hex(t.vid)}:${hex(t.pid)}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (failed === 0) code = 0;
  } catch (err) {
    log(`install failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  app.exit(code);
}

/** Run this exe again as admin, in helper mode. Resolves with its exit code. */
function installElevated(targets: UsbDevice[]): Promise<number> {
  const exe = process.execPath.replace(/'/g, "''");
  const arg = HELPER_FLAG + targets
    .map(t => `${hex(t.vid)}:${hex(t.pid)}:${t.composite ? t.mi : -1}`).join(',');
  // Start-Process throws when the prompt is declined; without the catch that
  // would come back as success.
  const script = `try { $p = Start-Process -FilePath '${exe}' -ArgumentList '${arg}' `
    + `-Verb RunAs -Wait -PassThru -ErrorAction Stop; exit $p.ExitCode } catch { exit ${DECLINED} }`;
  return new Promise(resolve => {
    const child = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true });
    child.on('error', err => { log(`powershell: ${err.message}`); resolve(1); });
    child.on('exit', code => resolve(code ?? 1));
  });
}

let busy = false;
// Once refused or failed, not again this run: one prompt per start, never one
// per pairing attempt.
let gaveUp = false;

/** Put every plugged-in receipt printer on WinUSB that is not already. */
export async function ensurePrinterDriver(win: BrowserWindow | null): Promise<void> {
  if (busy || gaveUp) return;
  cached = null;
  // Nothing plugged in, or all on WinUSB already. Checked again the next time
  // the till looks for its printer, so one plugged in later is still caught.
  const targets = printers().filter(p => p.driver.toLowerCase() !== 'winusb');
  if (targets.length === 0) return;

  busy = true;
  log(`installing WinUSB for ${targets.map(t => `${hex(t.vid)}:${hex(t.pid)} (${t.driver || 'no driver'})`).join(', ')}`);
  const parent = win && !win.isDestroyed() ? win : undefined;
  const show = (opts: Electron.MessageBoxOptions) =>
    parent ? dialog.showMessageBox(parent, opts) : dialog.showMessageBox(opts);

  try {
    // Said before Windows' own prompt, which on its own reads like something to refuse.
    await show({
      type: 'info',
      title: 'Possiblle POS',
      message: 'Çek yazıcısı üçün birdəfəlik quraşdırma',
      detail: 'Windows icazə soruşacaq — «Bəli» düyməsini basın.',
    });

    const code = await installElevated(targets);
    cached = null;
    if (code === 0) {
      await show({ type: 'info', title: 'Possiblle POS', message: 'Çek yazıcısı hazırdır.' });
    } else if (code === DECLINED) {
      gaveUp = true;
      log('admin prompt declined');
    } else {
      gaveUp = true;
      log(`helper exited ${code}`);
      await show({
        type: 'warning',
        title: 'Possiblle POS',
        message: 'Çek yazıcısı quraşdırılmadı.',
        detail: 'Proqramı yenidən açanda bir daha cəhd ediləcək.',
      });
    }
  } finally {
    busy = false;
  }
}

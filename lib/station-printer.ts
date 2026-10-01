// Where a sex's tickets go: a network printer by IP, or the till's own USB
// receipt printer.
//
// The USB choice is stored in the same printer_ip column as the word "usb", so
// it needs no migration and every reader that does not know about it sees a
// value that is not an IP and leaves it alone. It suits a small café where one
// printer beside the till does both the receipt and the bar's ticket.

export const USB_PRINTER = 'usb';

export const isUsbPrinter = (ip: string | null | undefined) =>
  ip?.trim().toLowerCase() === USB_PRINTER;

export function isValidIp(ip: string): boolean {
  const parts = ip.split('.');
  return parts.length === 4 && parts.every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/** A blank means "no printer yet"; anything else must be an IP or the USB choice. */
export const isValidPrinterTarget = (ip: string) => isValidIp(ip) || isUsbPrinter(ip);

/** How a sex's printer reads in a list. */
export const printerLabel = (ip: string) => isUsbPrinter(ip) ? 'USB (kassanın printeri)' : ip;

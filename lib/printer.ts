import type { Order } from '@/types';
import { stringToBytes, ESC, WIDTH } from './escpos';

const USB_VID = 0x1FC9;
const USB_PID = 0x2016;
const USB_ENDPOINT = 1;

let device: USBDevice | null = null;

function isWebUSBAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'usb' in navigator;
}

async function openDevice(d: USBDevice): Promise<void> {
  await d.open();
  if (d.configuration === null) await d.selectConfiguration(1);
  await d.claimInterface(0);
}

async function sendBytes(bytes: Uint8Array<ArrayBuffer>): Promise<boolean> {
  if (!device) {
    console.error('[Printer] Yazıcı qoşulu deyil');
    return false;
  }
  try {
    await device.transferOut(USB_ENDPOINT, bytes);
    return true;
  } catch (err) {
    console.error('[Printer] Göndərmə xətası:', err);
    device = null;
    return false;
  }
}

// Text goes through the CP857 encoder; command sequences with high bytes in them
// (the drawer pulse ends in 0xFF) must not, or the encoder reads them as letters.
async function sendRaw(data: string): Promise<boolean> {
  return sendBytes(new Uint8Array(stringToBytes(data)));
}

export async function connectPrinter(): Promise<boolean> {
  if (!isWebUSBAvailable()) return false;
  try {
    const devices = await navigator.usb.getDevices();
    const found = devices.find(d => d.vendorId === USB_VID && d.productId === USB_PID);
    if (!found) return false;
    await openDevice(found);
    device = found;
    return true;
  } catch (err) {
    console.error('[Printer] Avtomatik bağlantı xətası:', err);
    return false;
  }
}

export async function selectPrinter(): Promise<boolean> {
  if (!isWebUSBAvailable()) return false;
  try {
    const d = await navigator.usb.requestDevice({ filters: [{ vendorId: USB_VID, productId: USB_PID }] });
    await openDevice(d);
    device = d;
    return true;
  } catch (err) {
    console.error('[Printer] Yazıcı seçimi xətası:', err);
    return false;
  }
}

export async function disconnectPrinter(): Promise<void> {
  if (!device) return;
  try {
    await device.releaseInterface(0);
    await device.close();
  } catch { /* ignore */ }
  device = null;
}

export async function getPrinterList(): Promise<string[]> {
  if (!isWebUSBAvailable()) return [];
  const devices = await navigator.usb.getDevices();
  const found = devices.find(d => d.vendorId === USB_VID && d.productId === USB_PID);
  return found ? ['Xprinter XP-Q806K'] : [];
}

export function getSavedPrinter(): string | null {
  return device ? 'Xprinter XP-Q806K' : null;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function savePrinter(_name: string): void {
  // WebUSB persists authorization via browser — no manual save needed
}

export async function printReceipt(order: Order, companyName: string): Promise<boolean> {
  try {
    const total = (order.cashAmount ?? 0) + (order.cardAmount ?? 0) + (order.discountAmount ?? 0);
    const paid = (order.cashAmount ?? 0) + (order.cardAmount ?? 0);
    const date = new Date(order.createdAt).toLocaleString('az-AZ', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    // Every money line shares one right-hand column, so the amounts stack no
    // matter how long the label is.
    const row = (label: string, amount: string) => `${label}${amount.padStart(WIDTH - label.length)}\n`;
    const money = (n: number) => `${n.toFixed(2)}m`;

    const lines: string[] = [
      ESC.INIT,
      ESC.CODEPAGE,         // CP857 — Azerbaijani letters instead of '?'
      ESC.CENTER,
      ESC.BIG,
      companyName + '\n',
      ESC.NORMAL,
      '-'.repeat(WIDTH) + '\n',
      `Sifariş #${order.orderNumber}\n`,
      `Masa: ${order.tableNumber === 0 ? 'Takeaway' : order.tableNumber}\n`,
      `${date}\n`,
      `Kassir: ${order.sellerName}\n`,
      '='.repeat(WIDTH) + '\n',
      ESC.LEFT,
    ];

    for (const item of order.items) {
      // name | qty | price, summing to exactly WIDTH so nothing wraps
      const name = item.menuItem.name.substring(0, WIDTH - 12).padEnd(WIDTH - 12);
      const qty = `${item.quantity}x`.padStart(4);
      const price = money(item.menuItem.price * item.quantity).padStart(8);
      lines.push(`${name}${qty}${price}\n`);
      if (item.modifiers) lines.push(`  ${item.modifiers}\n`);
    }

    lines.push('='.repeat(WIDTH) + '\n');

    const discount = order.discountAmount ?? 0;
    if (discount > 0) {
      lines.push(row('Cəmi:', money(total)));
      // The percentage the cashier typed isn't stored — only the manat it came
      // to — so it's read back off the pre-discount total.
      const pct = total > 0 ? Math.round((discount / total) * 100) : 0;
      const label = order.discountType === '%' ? `Endirim (${pct}%)` : 'Endirim';
      lines.push(row(label, `-${money(discount)}`));
    }

    lines.push(ESC.BIG);
    lines.push(row('CƏMİ:', money(paid)));
    lines.push(ESC.NORMAL);

    if ((order.cashAmount ?? 0) > 0) lines.push(row('Nağd:', money(order.cashAmount!)));
    if ((order.cardAmount ?? 0) > 0) lines.push(row('Kart:', money(order.cardAmount!)));
    if ((order.changeAmount ?? 0) > 0) lines.push(row('Qaytarıldı:', money(order.changeAmount!)));

    lines.push(ESC.CENTER);
    lines.push('-'.repeat(WIDTH) + '\n');
    lines.push('Təşəkkürlər!\n');
    lines.push('\n\n\n');
    lines.push(ESC.CUT);

    return await sendRaw(lines.join(''));
  } catch (err) {
    console.error('[Printer] Cap alinmadi:', err);
    return false;
  }
}

// Sweeps every codepage index the printer might have and prints the Azerbaijani
// letters under each one, labelled. The line that reads "Çğıİöşü ÇĞIİÖŞÜ" names
// the index CODEPAGE_CP857 wants. An index the firmware doesn't know is ignored
// rather than refused, so those rows just repeat whatever page was last set —
// which is exactly how a wrong constant hides itself.
export async function printCodepageTest(): Promise<boolean> {
  const lines: string[] = [ESC.INIT, ESC.LEFT];
  // The bytes, not the letters: stringToBytes would rewrite the letters through
  // the map and defeat the test. These are the CP857 positions being probed.
  const sample = String.fromCharCode(0x87, 0xA7, 0x8D, 0x98, 0x94, 0x9F, 0x81, 0x20,
                                     0x80, 0xA6, 0x49, 0x98, 0x99, 0x9E, 0x9A);
  for (let n = 0; n <= 47; n++) {
    lines.push(`\x1B\x74${String.fromCharCode(n)}`, `${String(n).padStart(2)}: ${sample}\n`);
  }
  lines.push('\nDogru: Cgii-osu / CGIIOSU\n', ESC.CODEPAGE, '\n\n\n', ESC.CUT);
  return await sendBytes(new Uint8Array(lines.join('').split('').map(c => c.charCodeAt(0))));
}

export async function openCashDrawer(): Promise<boolean> {
  try {
    return await sendBytes(new Uint8Array([0x1B, 0x70, 0x00, 0x19, 0xFF]));
  } catch (err) {
    console.error('[Printer] Pul cekmeceyi acilmadi:', err);
    return false;
  }
}

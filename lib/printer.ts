import type { Order } from '@/types';
import { stringToBytes } from './escpos';

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

async function sendRaw(data: string): Promise<boolean> {
  if (!device) {
    console.error('[Printer] Yazıcı qoşulu deyil');
    return false;
  }
  try {
    const bytes = new Uint8Array(stringToBytes(data));
    await device.transferOut(USB_ENDPOINT, bytes);
    return true;
  } catch (err) {
    console.error('[Printer] Göndərmə xətası:', err);
    device = null;
    return false;
  }
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

    const lines: string[] = [
      '\x1B\x40',           // init printer
      '\x1B\x61\x01',       // center align
      '\x1B\x21\x10',       // double height
      companyName + '\n',
      '\x1B\x21\x00',       // normal size
      '--------------------------------\n',
      `Sifaris #${order.orderNumber}\n`,
      `Masa: ${order.tableNumber === 0 ? 'Takeaway' : order.tableNumber}\n`,
      `${date}\n`,
      `Kassir: ${order.sellerName}\n`,
      '================================\n',
      '\x1B\x61\x00',       // left align
    ];

    for (const item of order.items) {
      const name = item.menuItem.name.substring(0, 20).padEnd(20);
      const qty = `${item.quantity}x`;
      const price = ((item.menuItem.price) * item.quantity).toFixed(2);
      lines.push(`${name} ${qty.padStart(3)} ${price.padStart(7)}m\n`);
      if (item.modifiers) lines.push(`  ${item.modifiers}\n`);
    }

    lines.push('================================\n');

    if ((order.discountAmount ?? 0) > 0) {
      lines.push(`Cemi:           ${total.toFixed(2).padStart(7)}m\n`);
      const discLabel = order.discountType === '%'
        ? `Endirim (${order.discountAmount?.toFixed(2)}m)`
        : 'Endirim';
      lines.push(`${discLabel.padEnd(20)} -${(order.discountAmount ?? 0).toFixed(2).padStart(7)}m\n`);
    }

    lines.push('\x1B\x21\x10');  // double height
    lines.push(`CEMI:          ${paid.toFixed(2).padStart(7)}m\n`);
    lines.push('\x1B\x21\x00');  // normal

    if ((order.cashAmount ?? 0) > 0) lines.push(`Nagd:          ${(order.cashAmount ?? 0).toFixed(2).padStart(7)}m\n`);
    if ((order.cardAmount ?? 0) > 0) lines.push(`Kart:          ${(order.cardAmount ?? 0).toFixed(2).padStart(7)}m\n`);
    if ((order.changeAmount ?? 0) > 0) lines.push(`Qaytarildi:    ${(order.changeAmount ?? 0).toFixed(2).padStart(7)}m\n`);

    lines.push('\x1B\x61\x01');  // center
    lines.push('--------------------------------\n');
    lines.push('Tesekkuller!\n');
    lines.push('\n\n\n');
    lines.push('\x1D\x56\x41\x00');  // cut paper

    return await sendRaw(lines.join(''));
  } catch (err) {
    console.error('[Printer] Cap alinmadi:', err);
    return false;
  }
}

export async function openCashDrawer(): Promise<boolean> {
  try {
    return await sendRaw('\x1B\x70\x00\x19\xFF');
  } catch (err) {
    console.error('[Printer] Pul cekmeceyi acilmadi:', err);
    return false;
  }
}

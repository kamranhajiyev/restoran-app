import type { Order } from '@/types';
import { stringToBytes, ESC, WIDTH } from './escpos';
import { rasterize, type Line } from './raster';

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
    const row = (label: string, amount: string) => `${label}${amount.padStart(WIDTH - label.length)}`;
    const money = (n: number) => `${n.toFixed(2)}m`;

    const lines: Line[] = [
      { text: companyName, big: true, center: true },
      { text: '-'.repeat(WIDTH), center: true },
      { text: `Sifariş #${order.orderNumber}`, center: true },
      { text: `Masa: ${order.tableNumber === 0 ? 'Takeaway' : order.tableNumber}`, center: true },
      { text: date, center: true },
      { text: `Kassir: ${order.sellerName}`, center: true },
      { text: '='.repeat(WIDTH) },
    ];

    for (const item of order.items) {
      // name | qty | price, filling the line exactly
      const name = item.menuItem.name.substring(0, WIDTH - 12).padEnd(WIDTH - 12);
      const qty = `${item.quantity}x`.padStart(4);
      const price = money(item.menuItem.price * item.quantity).padStart(8);
      lines.push({ text: `${name}${qty}${price}` });
      if (item.modifiers) lines.push({ text: `  ${item.modifiers}` });
    }

    lines.push({ text: '='.repeat(WIDTH) });

    const discount = order.discountAmount ?? 0;
    if (discount > 0) {
      lines.push({ text: row('Cəmi:', money(total)) });
      // The percentage the cashier typed isn't stored — only the manat it came
      // to — so it's read back off the pre-discount total.
      const pct = total > 0 ? Math.round((discount / total) * 100) : 0;
      const label = order.discountType === '%' ? `Endirim (${pct}%)` : 'Endirim';
      lines.push({ text: row(label, `-${money(discount)}`) });
    }

    lines.push({ text: row('CƏMİ:', money(paid)), big: true });

    if ((order.cashAmount ?? 0) > 0) lines.push({ text: row('Nağd:', money(order.cashAmount!)) });
    if ((order.cardAmount ?? 0) > 0) lines.push({ text: row('Kart:', money(order.cardAmount!)) });
    if ((order.changeAmount ?? 0) > 0) lines.push({ text: row('Qaytarıldı:', money(order.changeAmount!)) });

    lines.push({ text: '-'.repeat(WIDTH), center: true });
    lines.push({ text: 'Təşəkkürlər!', center: true });

    const head = new Uint8Array(stringToBytes(ESC.INIT + ESC.LEFT));
    const image = rasterize(lines, WIDTH);
    const tail = new Uint8Array(stringToBytes('\n\n\n' + ESC.CUT));
    const out = new Uint8Array(head.length + image.length + tail.length);
    out.set(head, 0);
    out.set(image, head.length);
    out.set(tail, head.length + image.length);
    return await sendBytes(out);
  } catch (err) {
    console.error('[Printer] Cap alinmadi:', err);
    return false;
  }
}

export async function openCashDrawer(): Promise<boolean> {
  try {
    return await sendBytes(new Uint8Array([0x1B, 0x70, 0x00, 0x19, 0xFF]));
  } catch (err) {
    console.error('[Printer] Pul cekmeceyi acilmadi:', err);
    return false;
  }
}

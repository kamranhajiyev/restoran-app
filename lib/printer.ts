import type { Order } from '@/types';
import { stringToBytes, ESC, WIDTH } from './escpos';
import { rasterize, type Line, type Logo } from './raster';
import { loadLogo } from './logo';
import { orderLabel } from './order-label';

// Any USB printer, not one model. The till first ran an XP-Q806K (1FC9:2016)
// and the next one is an XP-S200M, whose ID nobody wrote down; a filter on one
// VID/PID left the picker empty for every printer but the first. Class 7 is the
// USB printer class most thermal printers declare; the vendor IDs catch the
// clones that call themselves vendor-specific instead.
const USB_FILTERS: USBDeviceFilter[] = [
  { classCode: 0x07 },
  { vendorId: 0x1FC9 },  // NXP — XP-Q806K
  { vendorId: 0x0483 },  // STMicro — many Xprinter models
  { vendorId: 0x0416 },  // Winbond — Xprinter / generic POS
  { vendorId: 0x28E9 },  // GigaDevice — newer Xprinter boards
];

let device: USBDevice | null = null;
// Read off the device rather than assumed: interface 0 / endpoint 1 held on the
// XP-Q806K, but a different board numbers its bulk-out pipe however it likes.
let iface = 0;
let endpoint = 1;

function isWebUSBAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'usb' in navigator;
}

async function openDevice(d: USBDevice): Promise<void> {
  await d.open();
  if (d.configuration === null) await d.selectConfiguration(1);
  for (const i of d.configuration?.interfaces ?? []) {
    for (const alt of i.alternates) {
      const out = alt.endpoints.find(e => e.direction === 'out' && e.type === 'bulk');
      if (!out) continue;
      await d.claimInterface(i.interfaceNumber);
      iface = i.interfaceNumber;
      endpoint = out.endpointNumber;
      return;
    }
  }
  await d.close();
  throw new Error('USB cihazında çap kanalı yoxdur');
}

async function sendBytes(bytes: Uint8Array<ArrayBuffer>): Promise<boolean> {
  if (!device) {
    console.error('[Printer] Yazıcı qoşulu deyil');
    return false;
  }
  try {
    await device.transferOut(endpoint, bytes);
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
    // getDevices() returns only what this site was already granted, which in
    // practice is the one printer someone picked — try each until one opens.
    for (const d of await navigator.usb.getDevices()) {
      try {
        await openDevice(d);
        device = d;
        return true;
      } catch { /* not a printer, or busy — try the next */ }
    }
    return false;
  } catch (err) {
    console.error('[Printer] Avtomatik bağlantı xətası:', err);
    return false;
  }
}

export async function selectPrinter(): Promise<boolean> {
  if (!isWebUSBAvailable()) return false;
  try {
    const d = await navigator.usb.requestDevice({ filters: USB_FILTERS });
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
    await device.releaseInterface(iface);
    await device.close();
  } catch { /* ignore */ }
  device = null;
}

const printerName = (d: USBDevice) => d.productName || 'USB yazıcı';

export async function getPrinterList(): Promise<string[]> {
  if (!isWebUSBAvailable()) return [];
  return (await navigator.usb.getDevices()).map(printerName);
}

export function getSavedPrinter(): string | null {
  return device ? printerName(device) : null;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function savePrinter(_name: string): void {
  // WebUSB persists authorization via browser — no manual save needed
}

// Every money line shares one right-hand column, so the amounts stack no
// matter how long the label is.
const row = (label: string, amount: string) => `${label}${amount.padStart(WIDTH - label.length)}`;
const money = (n: number) => `${n.toFixed(2)}m`;

// The header both papers share: who, which order, which table, when, whose.
function head(order: Order, companyName: string, heading?: string): Line[] {
  const date = new Date(order.createdAt).toLocaleString('az-AZ', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const lines: Line[] = [
    { text: companyName, big: true, center: true },
    { text: '-'.repeat(WIDTH), center: true },
  ];
  if (heading) lines.push({ text: heading, big: true, center: true });
  lines.push(
    // The label, not the bare number: on a second till these are the only two
    // characters telling this receipt apart from the other №45 in the room.
    { text: `Sifariş #${orderLabel(order)}`, center: true },
    { text: `Masa: ${order.tableNumber === 0 ? 'Takeaway' : order.tableNumber}`, center: true },
    { text: date, center: true },
    { text: `Ofisiant: ${order.sellerName}`, center: true },
    { text: '='.repeat(WIDTH) },
  );
  return lines;
}

// name | qty | price, filling the line exactly. The modifier rides on the
// same line as its dish — on a line of its own it read as another item.
function itemLines(order: Order): Line[] {
  return order.items.map(item => {
    const label = item.modifiers ? `${item.menuItem.name} (${item.modifiers})` : item.menuItem.name;
    const name = label.substring(0, WIDTH - 12).padEnd(WIDTH - 12);
    const qty = `${item.quantity}x`.padStart(4);
    const price = money(item.menuItem.price * item.quantity).padStart(8);
    return { text: `${name}${qty}${price}` };
  });
}

async function send(lines: Line[], logo?: Logo | null): Promise<boolean> {
  const prefix = new Uint8Array(stringToBytes(ESC.INIT + ESC.LEFT));
  const image = rasterize(lines, WIDTH, logo);
  const tail = new Uint8Array(stringToBytes('\n\n\n' + ESC.CUT));
  const out = new Uint8Array(prefix.length + image.length + tail.length);
  out.set(prefix, 0);
  out.set(image, prefix.length);
  out.set(tail, prefix.length + image.length);
  return await sendBytes(out);
}

// The bill the waiter carries to the table, printed while the order is still
// open. Deliberately not the same paper as printReceipt: the money has not been
// taken yet, so there is no cash/card split, no change and no thank-you — only
// what was eaten and what it comes to. "HESAB" at the top is what stops a
// customer from treating it as proof of payment.
export async function printBill(order: Order, companyName: string, logoUrl?: string | null): Promise<boolean> {
  try {
    const logo = await loadLogo(logoUrl);
    const gross = order.items.reduce((s, oi) => s + oi.menuItem.price * oi.quantity, 0);
    const discount = order.discountAmount ?? 0;

    const lines: Line[] = [...head(order, companyName, 'HESAB'), ...itemLines(order)];

    lines.push({ text: '='.repeat(WIDTH) });
    // A discount agreed before payment still belongs on the bill — the customer
    // is being asked for the net figure, not the menu one.
    if (discount > 0) {
      lines.push({ text: row('Cəmi:', money(gross)) });
      lines.push({ text: row('Endirim:', `-${money(discount)}`) });
    }
    lines.push({ text: row('ÖDƏNİLƏCƏK:', money(gross - discount)), big: true });
    lines.push({ text: '-'.repeat(WIDTH), center: true });

    return await send(lines, logo);
  } catch (err) {
    console.error('[Printer] Hesab cap alinmadi:', err);
    return false;
  }
}

export async function printReceipt(order: Order, companyName: string, logoUrl?: string | null): Promise<boolean> {
  try {
    const logo = await loadLogo(logoUrl);
    // A courier order closed on debt tenders nothing, so cash+card is 0. Reading
    // the total off that would print a 0.00 receipt and, worse, divide by zero
    // when reconstructing a percentage discount below.
    const debt = order.courierDebt ?? 0;
    const paid = (order.cashAmount ?? 0) + (order.cardAmount ?? 0) || debt;
    const total = paid + (order.discountAmount ?? 0);

    const lines: Line[] = [...head(order, companyName), ...itemLines(order)];

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
    // The guest has not paid yet — the rider collects at the door. Saying so on
    // the slip is the difference between a receipt and a demand for money.
    if (debt > 0) {
      lines.push({ text: row('ÖDƏNİLMƏYİB:', money(debt)) });
      lines.push({ text: 'Kuryer yığacaq', center: true });
    }

    lines.push({ text: '-'.repeat(WIDTH), center: true });
    lines.push({ text: 'Təşəkkürlər!', center: true });

    return await send(lines, logo);
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

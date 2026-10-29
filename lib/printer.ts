import type { Order } from '@/types';
import { stringToBytes, ESC, WIDTH } from './escpos';
import { rasterize, type Line, type Logo } from './raster';
import { ticketFontReady } from './ticket-font';
import { loadLogo } from './logo';
import { orderLabel } from './order-label';
import { PLACE_WORDS } from './order-place';
import { mergeLines } from './add-again';
import { isValidIp } from './station-printer';
import { installAndroidBridge } from './android-bridge';
import { formatDateTime } from './dates';
import { orderServiceCharge } from './service-charge';

installAndroidBridge();

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

export function isWebUSBAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'usb' in navigator;
}

// The Android app has no WebUSB — its WebView leaves it out — but it can reach
// the Wi-Fi. So there the receipt printer is an IP, kept on the device, and the
// bytes go through the app's socket like a sex's ticket. The exe has both, and
// keeps its USB printer.
const RECEIPT_IP_KEY = 'restoran_receipt_printer_ip';
const RECEIPT_PORT = 9100;

function wifiTill(): boolean {
  return typeof window !== 'undefined' && !!window.posNative && !isWebUSBAvailable();
}

function receiptIp(): string | null {
  try {
    const ip = localStorage.getItem(RECEIPT_IP_KEY);
    return ip && isValidIp(ip) ? ip : null;
  } catch { return null; }
}

/** Ask for the Wi-Fi receipt printer's IP. The current one is filled in to correct. */
function askReceiptIp(): boolean {
  const typed = window.prompt('Çek printerinin IP ünvanı (məs: 192.168.1.50)', receiptIp() ?? '');
  if (typed === null) return false;
  const ip = typed.trim();
  if (!isValidIp(ip)) {
    alert('IP düzgün deyil (məs: 192.168.1.50)');
    return false;
  }
  try { localStorage.setItem(RECEIPT_IP_KEY, ip); } catch { return false; }
  return true;
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

// One print at a time. A sex can print its tickets here too (see
// lib/station-printer.ts), so a receipt and a bar ticket may be sent at the same
// moment — queued one behind the other, never interleaved into one slip.
let queue: Promise<unknown> = Promise.resolve();

function sendBytes(bytes: Uint8Array<ArrayBuffer>): Promise<boolean> {
  const next = queue.then(async () => {
    if (wifiTill()) {
      const ip = receiptIp();
      if (!ip) return false;
      try {
        await window.posNative!.print(ip, RECEIPT_PORT, bytes);
        return true;
      } catch (err) {
        console.error('[Printer] Göndərmə xətası:', err);
        return false;
      }
    }
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
  });
  queue = next;
  return next;
}

/**
 * A sex's ticket, on the till's own USB printer. Throws when it did not print,
 * so the ticket stays in the queue exactly as one for a LAN printer that is off.
 */
export async function printRawToUsb(bytes: Uint8Array): Promise<void> {
  if (!wifiTill() && !device && !(await connectPrinter())) throw new Error('USB printer not connected');
  if (!(await sendBytes(new Uint8Array(bytes)))) throw new Error('USB printer did not take the ticket');
}

/** A USB printer is open, or one this site was granted opens now. Never asks. */
export async function usbPrinterReady(): Promise<boolean> {
  return !!device || connectPrinter();
}

export async function connectPrinter(): Promise<boolean> {
  if (wifiTill()) return receiptIp() !== null;
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
  if (wifiTill()) return askReceiptIp();
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
  if (wifiTill()) return receiptIp() ? [receiptIp()!] : [];
  if (!isWebUSBAvailable()) return [];
  return (await navigator.usb.getDevices()).map(printerName);
}

export function getSavedPrinter(): string | null {
  if (wifiTill()) return receiptIp();
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
function head(order: Order, companyName: string, heading?: string, table?: string): Line[] {
  const date = formatDateTime(order.createdAt);
  const lines: Line[] = [
    { text: companyName, big: true, center: true },
    { text: '-'.repeat(WIDTH), center: true },
  ];
  if (heading) lines.push({ text: heading, big: true, center: true });
  lines.push(
    // The label, not the bare number: on a second till these are the only two
    // characters telling this receipt apart from the other №45 in the room.
    { text: `Sifariş #${orderLabel(order)}`, center: true },
    // The table's name, not its id — see tableTitle in lib/order-place.ts. The id
    // is only there for a caller that has no table list to look it up in.
    // The same words as the till's screen (PLACE_WORDS).
    { text: order.tableNumber === 0
        ? (order.online ? PLACE_WORDS.online : order.courierId ? PLACE_WORDS.delivery : PLACE_WORDS.takeaway)
        : table ?? `Masa: ${order.tableNumber}`, center: true },
    { text: date, center: true },
    { text: `Ofisiant: ${order.sellerName}`, center: true },
    { text: '='.repeat(WIDTH) },
  );
  return lines;
}

// name | qty | price, filling the line exactly. The modifier rides on the
// same line as its dish — on a line of its own it read as another item.
// Batches of one dish print as one line, the way the till shows them: Limonad
// ordered 5 then 3 more read "5x" and "3x" on the guest's paper (Test Restoran,
// 2026-10-20). Another price stays its own line, so each line still adds up.
export function itemLines(order: Order): Line[] {
  return mergeLines(order.items, [], {}).lines.map(({ item, quantity }) => {
    const label = item.modifiers ? `${item.menuItem.name} (${item.modifiers})` : item.menuItem.name;
    const name = label.substring(0, WIDTH - 12).padEnd(WIDTH - 12);
    const qty = `${quantity}x`.padStart(4);
    const price = money(item.menuItem.price * quantity).padStart(8);
    return { text: `${name}${qty}${price}` };
  });
}

async function send(lines: Line[], logo?: Logo | null): Promise<boolean> {
  await ticketFontReady();
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
// taken yet, so there is no cash/card split and no change — only what was eaten
// and what it comes to. "HESAB" at the top is what stops a customer from
// treating it as proof of payment. The thank-you is on it too: this is the
// paper the guest actually reads (customer request, 2026-10-28).
export function billLines(order: Order, companyName: string, table?: string): Line[] {
  const gross = order.items.reduce((s, oi) => s + oi.menuItem.price * oi.quantity, 0);
  const service = orderServiceCharge(order);
  const discount = order.discountAmount ?? 0;

  const lines: Line[] = [...head(order, companyName, 'HESAB', table), ...itemLines(order)];

  lines.push({ text: '='.repeat(WIDTH) });
  // A discount agreed before payment still belongs on the bill — the customer
  // is being asked for the net figure, not the menu one.
  if (service > 0 || discount > 0) lines.push({ text: row('Cəmi:', money(gross)) });
  if (service > 0) lines.push(serviceLine(order, service));
  if (discount > 0) lines.push({ text: row('Endirim:', `-${money(discount)}`) });
  lines.push({ text: row('ÖDƏNİLƏCƏK:', money(gross + service - discount)), big: true });
  lines.push({ text: '-'.repeat(WIDTH), center: true });
  lines.push({ text: 'Təşəkkürlər!', center: true });
  return lines;
}

export async function printBill(order: Order, companyName: string, logoUrl?: string | null, table?: string): Promise<boolean> {
  try {
    const logo = await loadLogo(logoUrl);
    return await send(billLines(order, companyName, table), logo);
  } catch (err) {
    console.error('[Printer] Hesab cap alinmadi:', err);
    return false;
  }
}

// Xidmət haqqı on its own line, unlike an order type's price change: the guest
// is meant to see why the total is more than the dishes (lib/service-charge).
function serviceLine(order: Order, service: number): Line {
  return { text: row(`Xidmət haqqı (${order.serviceChargePercent}%):`, money(service)) };
}

export function receiptLines(order: Order, companyName: string, table?: string): Line[] {
  // A courier order closed on debt tenders nothing, so cash+card is 0. Reading
  // the total off that would print a 0.00 receipt and, worse, divide by zero
  // when reconstructing a percentage discount below.
  const debt = order.courierDebt ?? 0;
  const paid = (order.cashAmount ?? 0) + (order.cardAmount ?? 0) || debt;
  const total = paid + (order.discountAmount ?? 0);

  const lines: Line[] = [...head(order, companyName, undefined, table), ...itemLines(order)];

  lines.push({ text: '='.repeat(WIDTH) });

  const discount = order.discountAmount ?? 0;
  const service = orderServiceCharge(order);
  if (service > 0) {
    lines.push({ text: row('Cəmi:', money(order.items.reduce((s, oi) => s + oi.menuItem.price * oi.quantity, 0))) });
    lines.push(serviceLine(order, service));
  } else if (discount > 0) {
    lines.push({ text: row('Cəmi:', money(total)) });
  }
  if (discount > 0) {
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
  return lines;
}

export async function printReceipt(order: Order, companyName: string, logoUrl?: string | null, table?: string): Promise<boolean> {
  try {
    const logo = await loadLogo(logoUrl);
    return await send(receiptLines(order, companyName, table), logo);
  } catch (err) {
    console.error('[Printer] Cap alinmadi:', err);
    return false;
  }
}

// Tarixçə's Hesabat — the lines come from lib/history-report.
export async function printHistoryReport(lines: Line[]): Promise<boolean> {
  try {
    return await send(lines);
  } catch (err) {
    console.error('[Printer] Hesabat cap alinmadi:', err);
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

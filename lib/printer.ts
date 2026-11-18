import type { Order } from '@/types';
import { stringToBytes, ESC, WIDTH, wrap } from './escpos';
import { rasterize, type Line, type Logo } from './raster';
import { ticketFontReady } from './ticket-font';
import { loadLogo } from './logo';
import { orderLabel } from './order-label';
import { PLACE_WORDS } from './order-place';
import { mergeLines } from './add-again';
import { isValidIp } from './station-printer';
import { installAndroidBridge } from './android-bridge';
import { formatDateTime } from './dates';
import { dishesTotal, orderServiceCharge } from './service-charge';
import { orderTotal } from '@/components/seller/order-format';
import { tillDialogs } from './dialog-queue';
import type { SaleReturn } from './returns';
import type { LocalPrinter } from './desktopPrint';

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
// bytes go through the app's socket like a sex's ticket — or, since the app
// learned them, its own USB or Bluetooth (localReceipt below). The exe has both, so
// the cashier picks USB or IP there, and the till remembers which.
const RECEIPT_IP_KEY = 'restoran_receipt_printer_ip';
const RECEIPT_KIND_KEY = 'restoran_receipt_printer_kind';
const RECEIPT_PORT = 9100;

function hasSocket(): boolean {
  return typeof window !== 'undefined' && !!window.posNative;
}

function wifiTill(): boolean {
  return hasSocket() && !isWebUSBAvailable();
}

// The Android app can also print on a printer on the device itself — a USB
// cable or Bluetooth, which also reaches a Sunmi's built-in printer. Which one
// is kept on the device, like the IP.
type LocalKind = 'usb' | 'bt';
const RECEIPT_DEVICE_KEY = 'restoran_receipt_printer_device';
const RECEIPT_DEVICE_NAME_KEY = 'restoran_receipt_printer_name';

/** On Android, the USB or Bluetooth receipt printer that was picked, if one was. */
function localReceipt(): { kind: LocalKind; id: string; name: string } | null {
  if (!wifiTill()) return null;
  const n = window.posNative!;
  try {
    const kind = localStorage.getItem(RECEIPT_KIND_KEY);
    const id = localStorage.getItem(RECEIPT_DEVICE_KEY);
    if (!id) return null;
    // An older APK without that way of printing goes back to the IP.
    if (kind === 'usb' && n.printUsb) return { kind, id, name: localStorage.getItem(RECEIPT_DEVICE_NAME_KEY) ?? id };
    if (kind === 'bt' && n.printBt) return { kind, id, name: localStorage.getItem(RECEIPT_DEVICE_NAME_KEY) ?? id };
  } catch { /* no storage: the IP, as before */ }
  return null;
}

function setLocalReceipt(p: { kind: LocalKind } & LocalPrinter | null): void {
  try {
    if (p) {
      localStorage.setItem(RECEIPT_KIND_KEY, p.kind);
      localStorage.setItem(RECEIPT_DEVICE_KEY, p.id);
      localStorage.setItem(RECEIPT_DEVICE_NAME_KEY, p.name);
    } else {
      localStorage.removeItem(RECEIPT_KIND_KEY);
      localStorage.removeItem(RECEIPT_DEVICE_KEY);
      localStorage.removeItem(RECEIPT_DEVICE_NAME_KEY);
    }
  } catch { /* the choice lasts until the page closes */ }
}

/** What Android said, in words the cashier can act on. */
function localError(kind: LocalKind, err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (m.includes('bluetooth off')) return 'Bluetooth söndürülüb\n\nTelefonda Bluetooth-u yandırın.';
  if (m.includes('permission refused')) return 'İcazə verilmədi\n\nYenidən «Yazıcı seç» basıb «İcazə ver» seçin.';
  if (m.includes('no bluetooth')) return 'Bu cihazda Bluetooth yoxdur';
  return `${kind === 'usb' ? 'USB' : 'Bluetooth'} printer tapılmadı\n\n${m}`;
}

/**
 * "Yazıcı seç" on Android: Wi-Fi IP, USB or Bluetooth. An APK from before USB
 * and Bluetooth goes straight to the IP, as it always did.
 */
async function pickAndroidPrinter(): Promise<boolean> {
  const n = window.posNative!;
  const ways: { label: string; kind: 'ip' | LocalKind }[] = [{ label: 'IP (şəbəkə)', kind: 'ip' }];
  if (n.usbPrinters && n.printUsb) ways.push({ label: 'USB', kind: 'usb' });
  if (n.btPrinters && n.printBt) ways.push({ label: 'Bluetooth', kind: 'bt' });
  let kind: 'ip' | LocalKind = 'ip';
  if (ways.length > 1) {
    const pick = await tillDialogs.choose('Çek printeri necə qoşulub?', ways.map(w => w.label));
    if (pick === null) return false;
    kind = ways[pick].kind;
  }
  if (kind === 'ip') {
    if (!(await askReceiptIp())) return false;
    setLocalReceipt(null);
    return true;
  }
  let found: LocalPrinter[];
  try {
    found = await (kind === 'usb' ? n.usbPrinters!() : n.btPrinters!());
  } catch (err) {
    await tillDialogs.alert(localError(kind, err));
    return false;
  }
  if (found.length === 0) {
    await tillDialogs.alert(kind === 'usb'
      ? 'USB printer tapılmadı\n\nKabeli və printerin yandığını yoxlayın.'
      : 'Cütləşdirilmiş Bluetooth printer yoxdur\n\nƏvvəlcə telefonun Bluetooth ayarlarında printeri cütləşdirin.');
    return false;
  }
  let chosen = found[0];
  if (found.length > 1) {
    const pick = await tillDialogs.choose('Hansı printer?', found.map(f => f.name));
    if (pick === null) return false;
    chosen = found[pick];
  }
  setLocalReceipt({ kind, ...chosen });
  return true;
}

/** The receipt goes to the saved IP: on Android unless USB or Bluetooth was picked, on the exe when IP was picked. */
function ipReceipt(): boolean {
  if (wifiTill()) return localReceipt() === null;
  if (!hasSocket()) return false;
  try { return localStorage.getItem(RECEIPT_KIND_KEY) === 'ip'; } catch { return false; }
}

function setIpReceipt(on: boolean): void {
  try {
    if (on) localStorage.setItem(RECEIPT_KIND_KEY, 'ip');
    else localStorage.removeItem(RECEIPT_KIND_KEY);
  } catch { /* the choice lasts until the page closes */ }
}

function receiptIp(): string | null {
  try {
    const ip = localStorage.getItem(RECEIPT_IP_KEY);
    return ip && isValidIp(ip) ? ip : null;
  } catch { return null; }
}

/**
 * Ask for the LAN receipt printer's IP. The current one is filled in to correct.
 * The till's own box, not window.prompt: the exe has no prompt at all.
 */
async function askReceiptIp(): Promise<boolean> {
  const typed = await tillDialogs.ask('Çek printerinin IP ünvanı', { value: receiptIp() ?? '', placeholder: '192.168.1.50' });
  if (typed === null) return false;
  const ip = typed.trim();
  if (!isValidIp(ip)) {
    await tillDialogs.alert('IP düzgün deyil\n\nNümunə: 192.168.1.50');
    return false;
  }
  try { localStorage.setItem(RECEIPT_IP_KEY, ip); } catch { return false; }
  return true;
}

// Only one program can hold a USB printer at a time. A till that kept it open
// from page load locked every other one out: with the till open in Chrome, the
// exe on the same PC could not print at all. So the printer is taken for each
// print and let go straight after, as Poster does — `device` is only which
// printer, never an open handle.
async function openDevice(d: USBDevice): Promise<void> {
  await d.open();
  try {
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
    throw new Error('USB cihazında çap kanalı yoxdur');
  } catch (err) {
    await d.close().catch(() => {});
    throw err;
  }
}

async function letGo(d: USBDevice): Promise<void> {
  try { await d.releaseInterface(iface); } catch { /* not claimed */ }
  try { await d.close(); } catch { /* already closed */ }
}

// The other program may be printing at this very moment: wait and try again.
const USB_TRIES = 3;
const USB_RETRY_MS = 400;

async function printOnUsb(d: USBDevice, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await openDevice(d);
    } catch (err) {
      if (attempt >= USB_TRIES) throw err;
      await new Promise(r => setTimeout(r, USB_RETRY_MS));
      continue;
    }
    try {
      await d.transferOut(endpoint, bytes);
      return;
    } finally {
      await letGo(d);
    }
  }
}

// One print at a time. A sex can print its tickets here too (see
// lib/station-printer.ts), so a receipt and a bar ticket may be sent at the same
// moment — queued one behind the other, never interleaved into one slip.
let queue: Promise<unknown> = Promise.resolve();

function sendBytes(bytes: Uint8Array<ArrayBuffer>): Promise<boolean> {
  const next = queue.then(async () => {
    const local = localReceipt();
    if (local) {
      const n = window.posNative!;
      try {
        await (local.kind === 'usb' ? n.printUsb!(local.id, bytes) : n.printBt!(local.id, bytes));
        return true;
      } catch (err) {
        console.error('[Printer] Göndərmə xətası:', err);
        return false;
      }
    }
    if (ipReceipt()) {
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
      await printOnUsb(device, bytes);
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
  if (!ipReceipt() && !device && !(await connectPrinter())) throw new Error('USB printer not connected');
  if (!(await sendBytes(new Uint8Array(bytes)))) throw new Error('USB printer did not take the ticket');
}

/** A USB printer is open, or one this site was granted opens now. Never asks. */
export async function usbPrinterReady(): Promise<boolean> {
  return !!device || connectPrinter();
}

export async function connectPrinter(): Promise<boolean> {
  if (localReceipt()) return true;
  if (ipReceipt()) return receiptIp() !== null;
  if (!isWebUSBAvailable()) return false;
  try {
    // getDevices() returns only what this site was already granted, which in
    // practice is the one printer someone picked — try each until one opens.
    // Opened only to check it is a printer, then let go at once.
    for (const d of await navigator.usb.getDevices()) {
      try {
        await openDevice(d);
        await letGo(d);
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
  if (wifiTill()) return pickAndroidPrinter();
  if (!isWebUSBAvailable()) return false;
  // The exe can reach a LAN printer as well as a USB one, so the cashier says
  // which. The browser has no socket: USB only, no question. The USB picker
  // still runs on the button's click — the choice is our own popup, answered
  // by that click, so requestDevice keeps the gesture it needs.
  if (hasSocket()) {
    const pick = await tillDialogs.choose('Çek printeri necə qoşulub?', ['USB', 'IP (şəbəkə)']);
    if (pick === null) return false;
    if (pick === 1) {
      if (!(await askReceiptIp())) return false;
      await disconnectPrinter();
      setIpReceipt(true);
      return true;
    }
  }
  try {
    const d = await navigator.usb.requestDevice({ filters: USB_FILTERS });
    await openDevice(d);
    await letGo(d);
    device = d;
    setIpReceipt(false);
    return true;
  } catch (err) {
    console.error('[Printer] Yazıcı seçimi xətası:', err);
    return false;
  }
}

/** Forget the printer. It is never held between prints, so there is nothing to close. */
export async function disconnectPrinter(): Promise<void> {
  device = null;
}

const printerName = (d: USBDevice) => d.productName || 'USB yazıcı';

export async function getPrinterList(): Promise<string[]> {
  const local = localReceipt();
  if (local) return [local.name];
  if (ipReceipt()) return receiptIp() ? [receiptIp()!] : [];
  if (!isWebUSBAvailable()) return [];
  return (await navigator.usb.getDevices()).map(printerName);
}

export function getSavedPrinter(): string | null {
  const local = localReceipt();
  if (local) return local.name;
  if (ipReceipt()) return receiptIp();
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

/** A Mağaza's paper (SHOP-MODE.md). `delivery`: the shop also delivers, so a
 *  counter sale is called "Mağazada" to tell it from a Çatdırılma. Without
 *  delivery every sale is a counter sale and the word says nothing, so the
 *  paper leaves it off, as the screen does (orderPlace in lib/order-place). */
export interface ShopPaper { delivery: boolean }

// The header both papers share: who, which order, which table, when, whose.
// `shop`: a Mağaza's receipt — Qəbz, Kassir, and Mağazada only beside delivery.
function head(order: Order, companyName: string, heading?: string, table?: string, shop?: ShopPaper): Line[] {
  const date = formatDateTime(order.createdAt);
  const lines: Line[] = [
    { text: companyName, big: true, center: true },
    { text: '-'.repeat(WIDTH), center: true },
  ];
  if (heading) lines.push({ text: heading, big: true, center: true });
  // The table's name, not its id — see tableTitle in lib/order-place.ts. The id
  // is only there for a caller that has no table list to look it up in.
  // The same words as the till's screen (PLACE_WORDS).
  const place = order.tableNumber !== 0 ? table ?? `Masa: ${order.tableNumber}`
    : order.online ? PLACE_WORDS.online
    : order.courierId ? PLACE_WORDS.delivery
    : shop ? (shop.delivery ? PLACE_WORDS.shop : '')
    : PLACE_WORDS.takeaway;
  lines.push(
    // The label, not the bare number: on a second till these are the only two
    // characters telling this receipt apart from the other №45 in the room.
    { text: `${shop ? 'Qəbz' : 'Sifariş'} #${orderLabel(order)}`, center: true },
    ...(place ? [{ text: place, center: true }] : []),
    { text: date, center: true },
    { text: `${shop ? 'Kassir' : 'Ofisiant'}: ${order.sellerName}`, center: true },
    { text: '='.repeat(WIDTH) },
  );
  return lines;
}

// A restaurant's bill and receipt: the same columns as a shop's paper, so the
// guest sees the price of one beside the line's total (customer request,
// 2026-11-17). The modifier rides on its dish's line — on a line of its own it
// read as another item. Batches of one dish print as one line, the way the till
// shows them: Limonad ordered 5 then 3 more read "5x" and "3x" on the guest's
// paper (Test Restoran, 2026-10-20). Another price stays its own line, so each
// line still adds up.
export function itemLines(order: Order): Line[] {
  return shopItemLines(orderShopRows(order), 'Məhsul');
}

/** A shop's line: what it is, how many, the price of one. */
export interface ShopRow { name: string; qty: number; price: number }

// "10 əd", not "10.000 əd": the zeros a scale would print say nothing for a
// count. Kept to three places for the kq selling SHOP-MODE.md plans.
export const qtyText = (q: number) => `${Number(q.toFixed(3))} əd`;

const QTY_COL = 8;
const MONEY_COL = 9;
const NAME_COL = WIDTH - QTY_COL - 2 * MONEY_COL;

// A shop's paper writes money as bare numbers, like the columns above it: "61.25"
// beside "3.40", not "61.25m" — two ways of writing one manat read as two things.
const plain = (n: number) => n.toFixed(2);

// A shop's items the way a supermarket receipt prints them: Miqdar, Qiymət and
// Toplam in their own columns, so the customer checks the shelf price of one
// against the paper (customer request, 2026-11-17). A short name shares its
// row with the numbers; a long one wraps, and the numbers sit on its last row
// if that row leaves room, else on a row of their own — the columns never
// move. A hairline between items says which numbers are whose.
export function shopItemLines(rows: ShopRow[], nameHead = 'Malın adı'): Line[] {
  const lines: Line[] = [
    { text: nameHead.padEnd(NAME_COL) + 'Miqdar'.padStart(QTY_COL) + 'Qiymət'.padStart(MONEY_COL) + 'Toplam'.padStart(MONEY_COL) },
    { text: '-'.repeat(WIDTH) },
  ];
  rows.forEach((r, i) => {
    if (i > 0) lines.push({ text: '', rule: true });
    const nums = qtyText(r.qty).padStart(QTY_COL) + plain(r.price).padStart(MONEY_COL) + plain(r.price * r.qty).padStart(MONEY_COL);
    const name = wrap(r.name, WIDTH);
    const last = name[name.length - 1];
    // One space at least between a name and its quantity.
    const shares = last.length < NAME_COL;
    for (const w of shares ? name.slice(0, -1) : name) lines.push({ text: w });
    lines.push({ text: (shares ? last : '').padEnd(NAME_COL) + nums });
  });
  return lines;
}

// An order's lines as shop rows — merged exactly as itemLines merges them, so
// the two papers can never count the same order differently.
export function orderShopRows(order: Order): ShopRow[] {
  return mergeLines(order.items, [], {}).lines.map(({ item, quantity }) => ({
    name: item.modifiers ? `${item.menuItem.name} (${item.modifiers})` : item.menuItem.name,
    qty: quantity,
    price: item.menuItem.price,
  }));
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
  const gross = dishesTotal(order.items);
  const service = orderServiceCharge(order);
  const discount = order.discountAmount ?? 0;

  const lines: Line[] = [...head(order, companyName, 'HESAB', table), ...itemLines(order)];

  lines.push({ text: '='.repeat(WIDTH) });
  // A discount agreed before payment still belongs on the bill — the customer
  // is being asked for the net figure, not the menu one.
  if (service > 0 || discount > 0) lines.push({ text: row('Cəmi:', money(gross)) });
  if (service > 0) lines.push(serviceLine(order, service));
  if (discount > 0) lines.push({ text: row('Endirim:', `-${money(discount)}`) });
  // orderTotal, as the payment sheet will ask for
  lines.push({ text: row('ÖDƏNİLƏCƏK:', money(orderTotal(order))), big: true });
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
function serviceLine(order: Order, service: number, cur = money): Line {
  return { text: row(`Xidmət haqqı (${order.serviceChargePercent}%):`, cur(service)) };
}

// `barcode`: the order's number is the server's, not the till's guess, so the
// barcode at the foot cannot point a return at someone else's sale.
export function receiptLines(order: Order, companyName: string, table?: string, shop?: ShopPaper, barcode = false): Line[] {
  // A courier order closed on debt tenders nothing, so cash+card is 0. Reading
  // the total off that would print a 0.00 receipt and, worse, divide by zero
  // when reconstructing a percentage discount below.
  const debt = order.courierDebt ?? 0;
  const paid = (order.cashAmount ?? 0) + (order.cardAmount ?? 0) || debt;
  const total = paid + (order.discountAmount ?? 0);

  const lines: Line[] = [
    ...head(order, companyName, undefined, table, shop),
    ...(shop ? shopItemLines(orderShopRows(order)) : itemLines(order)),
    // Both print Miqdar · Qiymət · Toplam; only the first column's name differs.
  ];

  lines.push({ text: '='.repeat(WIDTH) });

  const cur = shop ? plain : money;
  const discount = order.discountAmount ?? 0;
  const service = orderServiceCharge(order);
  if (service > 0) {
    lines.push({ text: row('Cəmi:', cur(dishesTotal(order.items))) });
    lines.push(serviceLine(order, service, cur));
  } else if (discount > 0) {
    lines.push({ text: row('Cəmi:', cur(total)) });
  }
  if (discount > 0) {
    // The percentage the cashier typed isn't stored — only the manat it came
    // to — so it's read back off the pre-discount total.
    const pct = total > 0 ? Math.round((discount / total) * 100) : 0;
    const label = order.discountType === '%' ? `Endirim (${pct}%)` : 'Endirim';
    lines.push({ text: row(label, `-${cur(discount)}`) });
  }

  lines.push({ text: row('CƏMİ:', cur(paid)), big: true });

  if ((order.cashAmount ?? 0) > 0) lines.push({ text: row('Nağd:', cur(order.cashAmount!)) });
  if ((order.cardAmount ?? 0) > 0) lines.push({ text: row('Kart:', cur(order.cardAmount!)) });
  if ((order.changeAmount ?? 0) > 0) lines.push({ text: row('Qaytarıldı:', cur(order.changeAmount!)) });
  // The guest has not paid yet — the rider collects at the door. Saying so on
  // the slip is the difference between a receipt and a demand for money.
  if (debt > 0) {
    lines.push({ text: row('ÖDƏNİLMƏYİB:', cur(debt)) });
    lines.push({ text: 'Kuryer yığacaq', center: true });
  }

  lines.push({ text: '-'.repeat(WIDTH), center: true });
  lines.push({ text: 'Təşəkkürlər!', center: true });
  // A shop's receipt ends in its number as a barcode: a return finds the sale
  // with one scan (Qaytarma). Not before the server numbered it (0).
  if (shop && barcode && order.orderNumber) {
    lines.push({ text: '' });
    lines.push({ text: orderLabel(order), barcode: orderLabel(order) });
  }
  return lines;
}

export async function printReceipt(order: Order, companyName: string, logoUrl?: string | null, table?: string, shop?: ShopPaper, barcode = false): Promise<boolean> {
  try {
    const logo = await loadLogo(logoUrl);
    return await send(receiptLines(order, companyName, table, shop, barcode), logo);
  } catch (err) {
    console.error('[Printer] Cap alinmadi:', err);
    return false;
  }
}

// Qaytarma (lib/returns): the paper the customer gets back with the money —
// what came back, the minus total, how it was paid back, and who approved.
export function returnReceiptLines(r: Pick<SaleReturn, 'total' | 'pay' | 'sellerName' | 'approvedBy' | 'createdAt' | 'lines'>, companyName: string, receipt: string | null): Line[] {
  const lines: Line[] = [
    { text: companyName, big: true, center: true },
    { text: '-'.repeat(WIDTH), center: true },
    { text: 'QAYTARMA', big: true, center: true },
    ...(receipt ? [{ text: `Qəbz #${receipt}`, center: true }] : [{ text: 'Qəbzsiz', center: true }]),
    { text: formatDateTime(r.createdAt), center: true },
    ...(r.sellerName ? [{ text: `Kassir: ${r.sellerName}`, center: true }] : []),
    { text: '='.repeat(WIDTH) },
  ];
  // Qaytarma is a shop's paper: the same columns as the sale it undoes.
  lines.push(...shopItemLines(r.lines));
  lines.push({ text: '='.repeat(WIDTH) });
  lines.push({ text: row('CƏMİ:', `-${plain(r.total)}`), big: true });
  lines.push({ text: row(r.pay === 'cash' ? 'Nağd qaytarıldı:' : 'Karta qaytarıldı:', plain(r.total)) });
  if (r.approvedBy) lines.push({ text: `Təsdiq: ${r.approvedBy}`, center: true });
  return lines;
}

export async function printReturnReceipt(r: Parameters<typeof returnReceiptLines>[0], companyName: string, receipt: string | null): Promise<boolean> {
  try {
    return await send(returnReceiptLines(r, companyName, receipt));
  } catch (err) {
    console.error('[Printer] Qaytarma cap alinmadi:', err);
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

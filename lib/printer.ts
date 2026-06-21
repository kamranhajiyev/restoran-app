import type { Order } from '@/types';

const PRINTER_KEY = 'pos_printer_name';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let qz: any = null;

async function getQZ() {
  if (qz) return qz;
  const mod = await import('qz-tray');
  qz = mod.default ?? mod;
  return qz;
}

export async function connectPrinter(): Promise<boolean> {
  try {
    const q = await getQZ();
    if (q.websocket.isActive()) return true;
    await q.websocket.connect({ retries: 0, delay: 0 });
    return true;
  } catch (err) {
    console.error('[Printer] QZ Tray bağlantısı alınmadı:', err);
    return false;
  }
}

export async function disconnectPrinter(): Promise<void> {
  try {
    const q = await getQZ();
    if (q.websocket.isActive()) await q.websocket.disconnect();
  } catch (err) {
    console.error('[Printer] Bağlantı kəsilmədi:', err);
  }
}

export async function getPrinterList(): Promise<string[]> {
  try {
    const q = await getQZ();
    if (!q.websocket.isActive()) return [];
    const list = await q.printers.find();
    return Array.isArray(list) ? list : [list];
  } catch (err) {
    console.error('[Printer] Printer siyahısı alınmadı:', err);
    return [];
  }
}

export function getSavedPrinter(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(PRINTER_KEY);
}

export function savePrinter(name: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(PRINTER_KEY, name);
}

export async function printReceipt(order: Order, companyName: string): Promise<boolean> {
  try {
    const q = await getQZ();
    if (!q.websocket.isActive()) return false;
    const printer = getSavedPrinter();
    if (!printer) return false;

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
      `Sifariş #${order.orderNumber}\n`,
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
      lines.push(`${name} ${qty.padStart(3)} ${price.padStart(7)}₼\n`);
      if (item.modifiers) lines.push(`  ${item.modifiers}\n`);
    }

    lines.push('================================\n');

    if ((order.discountAmount ?? 0) > 0) {
      lines.push(`Cəmi:           ${total.toFixed(2).padStart(7)}₼\n`);
      const discLabel = order.discountType === '%'
        ? `Endirim (${order.discountAmount?.toFixed(2)}₼)`
        : 'Endirim';
      lines.push(`${discLabel.padEnd(20)} -${(order.discountAmount ?? 0).toFixed(2).padStart(7)}₼\n`);
    }

    lines.push('\x1B\x21\x10');  // double height
    lines.push(`CƏMİ:          ${paid.toFixed(2).padStart(7)}₼\n`);
    lines.push('\x1B\x21\x00');  // normal

    if ((order.cashAmount ?? 0) > 0) lines.push(`Nağd:          ${(order.cashAmount ?? 0).toFixed(2).padStart(7)}₼\n`);
    if ((order.cardAmount ?? 0) > 0) lines.push(`Kart:          ${(order.cardAmount ?? 0).toFixed(2).padStart(7)}₼\n`);
    if ((order.changeAmount ?? 0) > 0) lines.push(`Qaytarıldı:    ${(order.changeAmount ?? 0).toFixed(2).padStart(7)}₼\n`);

    lines.push('\x1B\x61\x01');  // center
    lines.push('--------------------------------\n');
    lines.push('Təşəkkürlər!\n');
    lines.push('\n\n\n');
    lines.push('\x1D\x56\x41\x00');  // cut paper

    const config = q.configs.create(printer, { encoding: 'UTF-8' });
    await q.print(config, [{ type: 'raw', format: 'plain', flavor: 'plain', data: lines.join('') }]);
    return true;
  } catch (err) {
    console.error('[Printer] Çap alınmadı:', err);
    return false;
  }
}

export async function openCashDrawer(): Promise<boolean> {
  try {
    const q = await getQZ();
    if (!q.websocket.isActive()) return false;
    const printer = getSavedPrinter();
    if (!printer) return false;
    const config = q.configs.create(printer, { encoding: 'UTF-8' });
    await q.print(config, [{ type: 'raw', format: 'plain', flavor: 'plain', data: '\x1B\x70\x00\x19\xFF' }]);
    return true;
  } catch (err) {
    console.error('[Printer] Pul çəkməcəsi açılmadı:', err);
    return false;
  }
}

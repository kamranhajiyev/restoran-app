import type { MenuItem, OrderItem, SelectedModifier } from '@/types';

// The "+" beside a line already on the order adds one more of it to the new
// batch — the same as finding it in the menu and tapping it again. The line
// on the order is never touched: the kitchen already has it.
//
// The product is taken from today's menu, not from the old line, so a dish
// switched off or deleted since can't come back through this button. Only a
// line with a size or options keeps its own price, because that price already
// holds what the seller picked.
export function addAgainLine(oi: OrderItem, menu: MenuItem[]): {
  item: MenuItem;
  mods?: string;
  variantId?: string;
  detail?: SelectedModifier[];
} | null {
  const current = menu.find(m => m.id === oi.menuItem.id && m.available);
  if (!current) return null;
  if (oi.variantId && !current.variants?.some(v => v.id === oi.variantId)) return null;
  const picked = !!(oi.variantId || oi.modifiers || oi.modifiersDetail?.length);
  if (!picked) return { item: current };
  return {
    item: { ...current, price: oi.menuItem.price },
    mods: oi.modifiers,
    variantId: oi.variantId,
    detail: oi.modifiersDetail,
  };
}

// "+" on a line with units waiting to come off takes one of those back first.
// Removing one and adding one new would send the kitchen a cancel slip and a
// fresh ticket for the same dish; nothing new is added until nothing is waiting.
export function takeBackOne(staged: Record<string, number>, id: string): Record<string, number> {
  const n = (staged[id] ?? 0) - 1;
  const next = { ...staged };
  if (n > 0) next[id] = n; else delete next[id];
  return next;
}

// One line per dish in the Əlavə panel. Every "Əlavə et" saves its own rows, so a
// table that ordered beer five times showed "Piva 1 əd" five times and the seller
// counted them by hand. Rows with the same product, size, options and price show
// as one line here; the new batch's matching lines ride on it as a green "+N",
// and only dishes not on the order yet are listed apart under YENİ. Display
// only: the rows, the order card and the kitchen tickets keep every batch.
export interface MergedLine {
  item: OrderItem;          // the first row, for the name, label and price
  rows: OrderItem[];        // every row behind this line, oldest first
  quantity: number;         // on the order now
  off: number;              // waiting to come off
  added: OrderItem[];       // new-batch lines for the same dish
  newSizes: OrderItem[];    // new-batch lines for the same product in another size or options
}

const sameDish = (a: OrderItem, b: OrderItem) =>
  a.menuItem.id === b.menuItem.id
  && (a.modifiers ?? '') === (b.modifiers ?? '')
  && (a.variantId ?? '') === (b.variantId ?? '');

export function mergeLines(existing: OrderItem[], cart: OrderItem[], staged: Record<string, number>): {
  lines: MergedLine[];
  extra: OrderItem[];
} {
  const lines: MergedLine[] = [];
  for (const oi of existing) {
    const line = lines.find(l => sameDish(l.item, oi) && l.item.menuItem.price === oi.menuItem.price);
    const off = oi.id ? staged[oi.id] ?? 0 : 0;
    if (line) { line.rows.push(oi); line.quantity += oi.quantity; line.off += off; }
    else lines.push({ item: oi, rows: [oi], quantity: oi.quantity, off, added: [], newSizes: [] });
  }
  // A dish re-priced between batches is two lines; the new units go on the first.
  const extra: OrderItem[] = [];
  for (const ci of cart) {
    const line = lines.find(l => sameDish(l.item, ci));
    if (line) { line.added.push(ci); continue; }
    // Fanta 2 L on an order that has Fanta 0.5 L sits right under it, so every
    // Fanta reads together; YENİ is left for products not on the order at all.
    const kin = [...lines].reverse().find(l => l.item.menuItem.id === ci.menuItem.id);
    if (kin) kin.newSizes.push(ci); else extra.push(ci);
  }
  return { lines, extra };
}

// Which row a "−" on a merged line takes from: the newest with something left.
export function rowToTakeFrom(line: MergedLine, staged: Record<string, number>): OrderItem | null {
  for (let i = line.rows.length - 1; i >= 0; i--) {
    const r = line.rows[i];
    if (r.id && r.quantity - (staged[r.id] ?? 0) > 0) return r;
  }
  return null;
}

// Which row a "+" gives a waiting removal back to: the newest still waiting.
export function rowToGiveBack(line: MergedLine, staged: Record<string, number>): OrderItem | null {
  for (let i = line.rows.length - 1; i >= 0; i--) {
    const r = line.rows[i];
    if (r.id && (staged[r.id] ?? 0) > 0) return r;
  }
  return null;
}

// The one button under the panel. It sends everything at once — removals, new
// lines and a changed note — so the seller never has a second, red button to
// press first (Test Restoran, 2026-10-20). Its name says what this press does.
export function submitButton(s: {
  appending: boolean;
  cartCount: number;
  removals: number;
  noteChanged: boolean;
  busy: boolean;
}): { label: string; disabled: boolean } {
  if (!s.appending) return { label: s.busy ? 'Göndərilir...' : 'Sifariş ver', disabled: s.cartCount === 0 || s.busy };
  const label = s.busy ? 'Göndərilir...'
    : s.cartCount > 0 ? 'Əlavə et'
    : s.removals > 0 ? 'Yadda saxla'
    : s.noteChanged ? 'Qeydi göndər'
    : 'Əlavə et';
  return { label, disabled: s.busy || (s.cartCount === 0 && s.removals === 0 && !s.noteChanged) };
}

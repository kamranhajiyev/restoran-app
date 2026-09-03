// 'employee' works one sex (station) and sees only what that sex prepares. Their
// profiles.station_id says which; every other role leaves it null.
export type Role = 'superadmin' | 'owner' | 'seller' | 'employee';

// A named floor plan. Tables belong to exactly one hall; the plan is drawn one
// hall at a time in both the admin and the seller panel.
export interface Hall {
  id: string;
  name: string;
  position: number;
}

export interface RestaurantTable {
  id: number;
  name: string;
  capacity: number;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  shape?: 'rect' | 'round' | 'rect-v';
  hallId?: string;
}

export interface TrashItem {
  id: string;
  type: string;
  data: Record<string, unknown>;
  deletedAt: string;
}

export interface Category {
  name: string;
  available: boolean;
  qrVisible?: boolean;  // absent = visible. Read only by the QR menu, never the POS.
}

// A prep station ("sex"): where an item is made, and which printer its ticket
// comes out of. printerIp is null until the venue puts a printer on that station.
export interface Station {
  id: string;
  name: string;
  printerIp?: string | null;
  printerPort?: number;
}

export interface MenuItemVariant {
  id: string;
  name: string;
  price: number;
  costPrice?: number;
}

// A reusable set of options ("Şuruplar", "Ölçü"). Built once, attached to as many
// menu items as the owner likes. Each selected option's price is ADDED on top of
// the item's base (or variant) price; an option priced 0 is a free choice.
export interface ModifierOption {
  id: string;
  name: string;
  price: number;      // 0 = no effect on the line price
  image?: string;
  position: number;
}

export interface ModifierGroup {
  id: string;
  name: string;
  minSelect: number;          // 1 = the seller must pick before the item can be added
  maxSelect: number | null;   // 1 = pick one; null = pick any number
  position: number;
  options: ModifierOption[];
}

// What the seller actually chose, snapshotted onto the order line. Display only —
// the money is already folded into OrderItem.menuItem.price.
export interface SelectedModifier {
  groupName: string;
  optionName: string;
  price: number;
}

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  category: string;
  available: boolean;
  qrVisible?: boolean;         // absent = visible. QR menu only; the POS ignores it.
  variants?: MenuItemVariant[];
  costPrice?: number;
  image?: string;
  stationId?: string | null;   // which sex prepares it; null = unassigned
  kind?: 'product' | 'meal';   // absent = treat as 'product'
  modifierGroupIds?: string[]; // which reusable sets this item offers
}

export interface OrderItem {
  id?: string;          // order_items row id — present on fetched orders, absent for cart items
  menuItem: MenuItem;
  quantity: number;
  modifiers?: string;
  // The per-option breakdown behind `modifiers`. Absent on rows written before
  // modifier sets existed, and on lines with no modifiers. menuItem.price already
  // includes these prices, so no total needs to read this.
  modifiersDetail?: SelectedModifier[];
  variantId?: string;   // which variant was chosen — drives per-variant stock deduction
  createdAt?: string;   // groups the item into a batch: the original order, or a later "Əlavə et"
  removedAt?: string;   // set = struck through on the order card, and excluded from every total
  removedBy?: string;
}

export type OrderStatus = 'gözləyir' | 'hazırlanır' | 'hazırdır' | 'ödənilib' | 'ləğv edildi' | 'silinib';

// Paid and cancelled orders are both closed: they free the table and leave
// every "active" list. Only paid ones count as revenue.
export function isOrderOpen(o: { status: OrderStatus }): boolean {
  return o.status !== 'ödənilib' && o.status !== 'ləğv edildi' && o.status !== 'silinib';
}

export interface ShiftMovement {
  at: string;
  amount: number; // positive = into drawer, negative = out
  reason: string;
  by: string;
  id?: string; // optional: movements written before the backfill have none, and can't be edited
}

// One admin correction to a shift. Written by the same SQL statement that makes
// the change, so a shift can't be edited without saying who did it and what moved.
export interface ShiftEdit {
  at: string;
  by: string;
  action: 'movement_edit' | 'movement_delete' | 'totals_edit';
  field?: 'countedCash' | 'countedCard'; // totals_edit only
  from?: ShiftMovement | number | null;
  to?: ShiftMovement | number | null;
}

export interface CashShift {
  id: string;
  openedAt: string;
  openedBy: string;
  openingCash: number;
  closedAt?: string;
  closedBy?: string;
  expectedCash?: number; // snapshot at close
  countedCash?: number;
  cardSales?: number;   // card sales recorded in the app, snapshot at close
  countedCard?: number; // terminal Z-report total entered at close
  movements: ShiftMovement[];
  edits: ShiftEdit[];
}

// Poster-style floor staff: identified by a 4-digit PIN on a logged-in
// terminal instead of an auth account. The PIN hash never leaves the database.
export interface Staff {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
}

// ─── Anbar (warehouse / inventory) ────────────────────────────────────────────

export interface Warehouse {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  note?: string;
  active: boolean;
  createdAt: string;
}

export interface StockItem {
  id: string;
  name: string;
  unit: string;
  type?: 'product' | 'ingredient';   // absent = treat as 'ingredient'
  createdAt: string;
}

// A row of the Qalıqlar view: an item's current quantity in one warehouse.
export interface StockBalance {
  warehouseId: string;
  stockItemId: string;
  name: string;
  unit: string;
  qty: number;
}

export interface StockMovement {
  id: string;
  warehouseId: string;
  stockItemId: string;
  qty: number;
  reason: 'receipt' | 'writeoff' | 'recount' | 'sale' | 'sale_void' | 'void'
    | 'transfer_out' | 'transfer_in' | 'transfer_void';
  unitCost?: number;
  receiptId?: string;
  transferId?: string;
  note?: string;
  createdBy?: string;
  createdAt: string;
}

export interface StockReceipt {
  id: string;
  warehouseId: string;
  supplierId?: string;
  total: number;
  paidAmount: number;
  note?: string;
  createdBy?: string;
  createdAt: string;
  voidedAt?: string;
  voidedBy?: string;
}

// One line of an existing goods receipt (reconstructed from stock_movements).
export interface ReceiptLineDetail {
  stockItemId: string;
  name: string;
  unit: string;
  qty: number;
  unitCost?: number;
}

// Anbarlar arası transfer: one move of goods from one warehouse to another.
export interface StockTransfer {
  id: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  note?: string;
  createdBy?: string;
  createdAt: string;
  voidedAt?: string;
  voidedBy?: string;
}

export interface TransferLine {
  stockItemId: string;
  qty: number;
}

// One line of an existing transfer (reconstructed from its transfer_out movements).
export interface TransferLineDetail {
  stockItemId: string;
  name: string;
  unit: string;
  qty: number;          // positive magnitude moved
}

// A write-off entry for the Silinmələr log.
export interface WriteoffEntry {
  id: string;
  warehouseId: string;
  warehouseName: string;
  stockItemId: string;
  name: string;
  unit: string;
  qty: number;          // positive magnitude removed
  reason?: string;      // from stock_movements.note
  createdBy?: string;
  createdAt: string;
}

// Per-supplier money summary for the Tədarükçülər view.
export interface SupplierLedger {
  total: number;   // total purchased (non-voided receipts)
  paid: number;    // paid on receipts + standalone payments
  debt: number;    // total − paid
}

// One standalone payment to a supplier, for the Ödənişlər log.
export interface SupplierPayment {
  id: string;
  supplierId: string;
  supplierName: string;
  amount: number;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

// One line of a goods receipt, as sent to record_receipt.
export interface ReceiptLine {
  stockItemId: string;
  qty: number;
  unitCost?: number;
}

// One ingredient of a recipe (how much of a stock item a menu item consumes).
export interface RecipeIngredient {
  stockItemId: string;
  qty: number;
}

// A flat recipe row as stored in recipe_lines.
export interface RecipeLineRow {
  menuItemId: string;
  stockItemId: string;
  qty: number;
}

export interface Order {
  id: string;
  orderNumber: number;
  // Which desktop till issued that number, 1-9. Absent everywhere the server
  // numbered the order — the web till, the QR menu — because a number the
  // counter handed out cannot collide with anything. An offline till numbers
  // its own orders, so two tills in one restaurant can both reach 45; this is
  // what tells them apart. See lib/order-label.ts for how it is shown.
  tillNumber?: number;
  tableNumber: number;
  items: OrderItem[];
  // Items the waiter pulled off the order. Kept OUT of `items` on purpose: every
  // total, the Analiz report, the Excel export and the customer receipt all read
  // `items`, and a removed dish appearing in any of them would over-count revenue
  // and over-charge the guest. Only the order cards read this.
  removedItems?: OrderItem[];
  status: OrderStatus;
  createdAt: string;
  sellerName: string;
  staffId?: string;
  note?: string;
  cashAmount?: number;   // money kept in the till (net of change given back)
  cardAmount?: number;
  changeAmount?: number; // returned to the customer — display only, never revenue
  discountAmount?: number;
  discountType?: '%' | '₼';
  paidAt?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  cancelReason?: string;
}

export type Role = 'superadmin' | 'owner' | 'seller';

export interface RestaurantTable {
  id: number;
  name: string;
  capacity: number;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  shape?: 'rect' | 'round' | 'rect-v';
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
}

export interface MenuItemVariant {
  id: string;
  name: string;
  price: number;
  costPrice?: number;
}

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  category: string;
  available: boolean;
  variants?: MenuItemVariant[];
  costPrice?: number;
  image?: string;
  cookingStation?: string;
  kind?: 'product' | 'meal';   // absent = treat as 'product'
}

export interface OrderItem {
  id?: string;          // order_items row id — present on fetched orders, absent for cart items
  menuItem: MenuItem;
  quantity: number;
  modifiers?: string;
  variantId?: string;   // which variant was chosen — drives per-variant stock deduction
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
  reason: 'receipt' | 'writeoff' | 'recount' | 'sale' | 'sale_void' | 'void';
  unitCost?: number;
  receiptId?: string;
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
  tableNumber: number;
  items: OrderItem[];
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
  cancelledAt?: string;
  cancelledBy?: string;
  cancelReason?: string;
}

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
}

export interface OrderItem {
  menuItem: MenuItem;
  quantity: number;
  modifiers?: string;
}

export type OrderStatus = 'gözləyir' | 'hazırlanır' | 'hazırdır' | 'ödənilib' | 'ləğv edildi';

// Paid and cancelled orders are both closed: they free the table and leave
// every "active" list. Only paid ones count as revenue.
export function isOrderOpen(o: { status: OrderStatus }): boolean {
  return o.status !== 'ödənilib' && o.status !== 'ləğv edildi';
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

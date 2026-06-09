export type Role = 'admin' | 'seller';

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

export type OrderStatus = 'gözləyir' | 'hazırlanır' | 'hazırdır' | 'ödənilib';

export interface Order {
  id: string;
  orderNumber: number;
  tableNumber: number;
  items: OrderItem[];
  status: OrderStatus;
  createdAt: string;
  sellerName: string;
  note?: string;
  cashAmount?: number;
  cardAmount?: number;
}

import { MenuItem, Order } from '@/types';
import { supabase } from './supabase';

const MENU_KEY = 'restoran_menu';
const ORDERS_KEY = 'restoran_orders';
const ORDER_COUNTER_KEY = 'restoran_order_counter';
const CATEGORIES_KEY = 'restoran_categories';

const DEFAULT_CATEGORIES = ['Salatlar', 'Şorbalar', 'Əsas Yeməklər', 'Qəlyanaltı', 'İçkilər', 'Desertlər'];

export function getCategories(): string[] {
  if (typeof window === 'undefined') return DEFAULT_CATEGORIES;
  const raw = localStorage.getItem(CATEGORIES_KEY);
  return raw ? JSON.parse(raw) : DEFAULT_CATEGORIES;
}

export function saveCategories(categories: string[]): void {
  localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories));
  void pushCategoriesToSupabase(categories);
}

async function pushCategoriesToSupabase(categories: string[]): Promise<void> {
  try {
    await supabase.from('categories').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('categories').insert(
      categories.map((name, position) => ({ name, position }))
    );
  } catch { /* offline */ }
}

export async function pullCategoriesFromSupabase(): Promise<void> {
  try {
    const { data, error } = await supabase.from('categories').select('name').order('position');
    if (error || !data || data.length === 0) return;
    const cats = data.map((r: { name: string }) => r.name);
    localStorage.setItem(CATEGORIES_KEY, JSON.stringify(cats));
  } catch { /* offline */ }
}

// ─── default menu ────────────────────────────────────────────────────────────

const defaultMenu: MenuItem[] = [
  { id: '1', name: 'Çoban Salat', price: 4, category: 'Salatlar', available: true },
  { id: '2', name: 'Kənd Salat', price: 4.5, category: 'Salatlar', available: true },
  { id: '3', name: 'Düşbərə', price: 5, category: 'Şorbalar', available: true },
  { id: '4', name: 'Piti', price: 7, category: 'Şorbalar', available: true },
  { id: '5', name: 'Lülə Kabab', price: 9, category: 'Əsas Yeməklər', available: true },
  { id: '6', name: 'Toyuq Kabab', price: 8, category: 'Əsas Yeməklər', available: true },
  { id: '7', name: 'Qutab', price: 3, category: 'Qəlyanaltı', available: true },
  { id: '8', name: 'Çay', price: 1.5, category: 'İçkilər', available: true },
  { id: '9', name: 'Ayran', price: 2, category: 'İçkilər', available: true },
];

// ─── local helpers ────────────────────────────────────────────────────────────

function localMenu(): MenuItem[] {
  if (typeof window === 'undefined') return defaultMenu;
  const raw = localStorage.getItem(MENU_KEY);
  if (!raw) {
    localStorage.setItem(MENU_KEY, JSON.stringify(defaultMenu));
    return defaultMenu;
  }
  return JSON.parse(raw);
}

function localOrders(): Order[] {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(ORDERS_KEY);
  return raw ? JSON.parse(raw) : [];
}

export function nextOrderNumber(): number {
  if (typeof window === 'undefined') return 1;
  const current = parseInt(localStorage.getItem(ORDER_COUNTER_KEY) ?? '0', 10);
  const next = current + 1;
  localStorage.setItem(ORDER_COUNTER_KEY, String(next));
  return next;
}

// ─── menu ─────────────────────────────────────────────────────────────────────

export function getMenu(): MenuItem[] {
  return localMenu();
}

export function saveMenu(menu: MenuItem[]) {
  localStorage.setItem(MENU_KEY, JSON.stringify(menu));
  pushMenuToSupabase(menu);
}

export async function syncMenuToSupabase(): Promise<void> {
  await pushMenuToSupabase(localMenu());
}

async function pushMenuToSupabase(menu: MenuItem[]) {
  try {
    const { error: delErr } = await supabase.from('menu_items').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (delErr) { console.error('[menu push] delete:', delErr.message); return; }
    const rows = menu.map(m => ({
      id: isValidUUID(m.id) ? m.id : crypto.randomUUID(),
      name: m.name,
      price: m.price,
      category: m.category,
      available: m.available,
      variants: m.variants ?? null,
      cost_price: m.costPrice ?? null,
      image: m.image ?? null,
      cooking_station: m.cookingStation ?? null,
    }));
    const { error: insErr } = await supabase.from('menu_items').insert(rows);
    if (insErr) console.error('[menu push] insert:', insErr.message);
    else console.log('[menu push] ok —', rows.length, 'items');
  } catch (e) { console.error('[menu push] exception:', e); }
}

function isValidUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

export async function pullMenuFromSupabase(): Promise<boolean> {
  try {
    const { data, error } = await supabase.from('menu_items').select('*').order('created_at');
    if (error || !data) return false;
    const menu: MenuItem[] = data.map(r => ({
      id: r.id,
      name: r.name,
      price: Number(r.price),
      category: r.category,
      available: r.available,
      variants: r.variants ?? undefined,
      costPrice: r.cost_price ? Number(r.cost_price) : undefined,
      image: r.image ?? undefined,
      cookingStation: r.cooking_station ?? undefined,
    }));
    if (menu.length > 0) {
      localStorage.setItem(MENU_KEY, JSON.stringify(menu));
    }
    return true;
  } catch {
    return false;
  }
}

// ─── orders ───────────────────────────────────────────────────────────────────

export function getOrders(): Order[] {
  return localOrders();
}

export function saveOrders(orders: Order[]) {
  localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
}

export function addOrder(order: Order) {
  const orders = localOrders();
  orders.unshift(order);
  saveOrders(orders);
  pushOrderToSupabase(order);
}

export function updateOrderStatus(orderId: string, status: Order['status'], paymentMethod?: Order['paymentMethod']) {
  const orders = localOrders();
  const idx = orders.findIndex(o => o.id === orderId);
  if (idx !== -1) {
    orders[idx].status = status;
    if (paymentMethod) orders[idx].paymentMethod = paymentMethod;
    saveOrders(orders);
    void supabase.from('orders').update({ status, payment_method: paymentMethod ?? null }).eq('id', orderId);
  }
}

async function pushOrderToSupabase(order: Order) {
  try {
    await supabase.from('orders').insert({
      id: order.id,
      table_id: order.tableNumber,
      waiter_name: order.sellerName,
      status: order.status,
      note: order.note ?? null,
      created_at: order.createdAt,
    });
    await supabase.from('order_items').insert(
      order.items.map(oi => ({
        order_id: order.id,
        menu_item_id: oi.menuItem.id,
        menu_item_name: oi.menuItem.name,
        menu_item_price: oi.menuItem.price,
        quantity: oi.quantity,
      }))
    );
  } catch { /* offline */ }
}

export async function pullOrdersFromSupabase(): Promise<boolean> {
  try {
    const { data: ordersData, error } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .order('created_at', { ascending: false });
    if (error || !ordersData) return false;
    const orders: Order[] = ordersData.map((o, i) => ({
      id: o.id,
      orderNumber: ordersData.length - i,
      tableNumber: o.table_id,
      sellerName: o.waiter_name,
      status: o.status,
      note: o.note ?? undefined,
      createdAt: o.created_at,
      paymentMethod: o.payment_method ?? undefined,
      items: (o.order_items ?? []).map((oi: { menu_item_id: string; menu_item_name: string; menu_item_price: number; quantity: number }) => ({
        menuItem: {
          id: oi.menu_item_id,
          name: oi.menu_item_name,
          price: Number(oi.menu_item_price),
          category: '',
          available: true,
        },
        quantity: oi.quantity,
      })),
    }));
    localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
    return true;
  } catch {
    return false;
  }
}

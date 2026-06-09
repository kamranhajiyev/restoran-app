import { Category, MenuItem, Order, TrashItem } from '@/types';
import { supabase } from './supabase';

const DEFAULT_CATEGORIES = ['Qəhvə', 'Çay', 'Soyuq içkilər', 'Şirniyyat', 'Snack', 'Xüsusi'];

function isValidUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

// ─── Menu ─────────────────────────────────────────────────────────────────────

export async function fetchMenu(): Promise<MenuItem[]> {
  try {
    const { data, error } = await supabase.from('menu_items').select('*').order('position');
    if (error || !data) return [];
    return data.map(r => ({
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
  } catch {
    return [];
  }
}

export async function saveMenu(menu: MenuItem[]): Promise<void> {
  try {
    await supabase.from('menu_items').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    const rows = menu.map((m, i) => ({
      id: isValidUUID(m.id) ? m.id : crypto.randomUUID(),
      name: m.name,
      price: m.price,
      category: m.category,
      available: m.available,
      variants: m.variants ?? null,
      cost_price: m.costPrice ?? null,
      image: m.image ?? null,
      cooking_station: m.cookingStation ?? null,
      position: i,
    }));
    if (rows.length > 0) await supabase.from('menu_items').insert(rows);
  } catch (e) {
    console.error('[saveMenu]', e);
  }
}

// ─── Categories ───────────────────────────────────────────────────────────────

export async function fetchCategories(): Promise<Category[]> {
  try {
    const { data, error } = await supabase.from('categories').select('name, available').order('position');
    if (error || !data || data.length === 0) return DEFAULT_CATEGORIES.map(name => ({ name, available: true }));
    return data.map((r: { name: string; available: boolean }) => ({ name: r.name, available: r.available }));
  } catch {
    return DEFAULT_CATEGORIES.map(name => ({ name, available: true }));
  }
}

export async function saveCategories(categories: Category[]): Promise<void> {
  try {
    await supabase.from('categories').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('categories').insert(categories.map((c, position) => ({ name: c.name, available: c.available, position })));
  } catch (e) {
    console.error('[saveCategories]', e);
  }
}

// ─── Trash ────────────────────────────────────────────────────────────────────

export async function fetchTrash(): Promise<TrashItem[]> {
  try {
    await supabase.from('trash_items').delete().lt('deleted_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
    const { data, error } = await supabase.from('trash_items').select('*').order('deleted_at', { ascending: false });
    if (error || !data) return [];
    return data.map(r => ({ id: r.id, type: r.type, data: r.data, deletedAt: r.deleted_at }));
  } catch { return []; }
}

export async function moveToTrash(type: string, item: Record<string, unknown>): Promise<void> {
  try {
    await supabase.from('trash_items').insert({ type, data: item });
  } catch (e) { console.error('[moveToTrash]', e); }
}

export async function restoreFromTrash(id: string): Promise<void> {
  try {
    await supabase.from('trash_items').delete().eq('id', id);
  } catch (e) { console.error('[restoreFromTrash]', e); }
}

export async function permanentlyDeleteFromTrash(id: string): Promise<void> {
  try {
    await supabase.from('trash_items').delete().eq('id', id);
  } catch (e) { console.error('[permanentlyDeleteFromTrash]', e); }
}

// ─── Orders ───────────────────────────────────────────────────────────────────

export async function fetchOrders(): Promise<Order[]> {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    return data.map((o, i) => ({
      id: o.id,
      orderNumber: data.length - i,
      tableNumber: o.table_id ?? 0,
      sellerName: o.waiter_name,
      status: o.status as Order['status'],
      note: o.note ?? undefined,
      createdAt: o.created_at,
      cashAmount: o.cash_amount ? Number(o.cash_amount) : undefined,
      cardAmount: o.card_amount ? Number(o.card_amount) : undefined,
      items: (o.order_items ?? []).map((oi: { menu_item_id: string; menu_item_name: string; menu_item_price: number; quantity: number; modifiers?: string }) => ({
        menuItem: {
          id: oi.menu_item_id,
          name: oi.menu_item_name,
          price: Number(oi.menu_item_price),
          category: '',
          available: true,
        },
        quantity: oi.quantity,
        modifiers: oi.modifiers ?? undefined,
      })),
    }));
  } catch {
    return [];
  }
}

export async function addOrder(order: Order): Promise<void> {
  try {
    await supabase.from('orders').insert({
      id: order.id,
      table_id: order.tableNumber === 0 ? null : order.tableNumber,
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
        modifiers: oi.modifiers ?? null,
      }))
    );
  } catch (e) {
    console.error('[addOrder]', e);
  }
}

export async function updateOrderStatus(
  orderId: string,
  status: Order['status'],
  cashAmount?: number,
  cardAmount?: number,
): Promise<void> {
  const { error } = await supabase
    .from('orders')
    .update({ status, cash_amount: cashAmount ?? 0, card_amount: cardAmount ?? 0 })
    .eq('id', orderId);
  if (error) console.error('[updateOrderStatus]', error.message);
}

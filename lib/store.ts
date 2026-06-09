import { Category, MenuItem, Order, TrashItem } from '@/types';
import { supabase } from './supabase';

const DEFAULT_CATEGORIES = ['Qəhvə', 'Çay', 'Soyuq içkilər', 'Şirniyyat', 'Snack', 'Xüsusi'];

let _companyId: string | null = null;

export function setCompanyContext(id: string | null) {
  _companyId = id;
}

function isValidUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

// ─── Menu ─────────────────────────────────────────────────────────────────────

export async function fetchMenu(): Promise<MenuItem[]> {
  try {
    let q = supabase.from('menu_items').select('*').order('position');
    if (_companyId) q = q.eq('company_id', _companyId);
    const { data, error } = await q;
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
    let delQ = supabase.from('menu_items').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (_companyId) delQ = delQ.eq('company_id', _companyId);
    await delQ;
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
      company_id: _companyId,
    }));
    if (rows.length > 0) await supabase.from('menu_items').insert(rows);
  } catch (e) {
    console.error('[saveMenu]', e);
  }
}

// ─── Categories ───────────────────────────────────────────────────────────────

export async function fetchCategories(): Promise<Category[]> {
  try {
    let q = supabase.from('categories').select('name, available').order('position');
    if (_companyId) q = q.eq('company_id', _companyId);
    const { data, error } = await q;
    if (error || !data || data.length === 0) return DEFAULT_CATEGORIES.map(name => ({ name, available: true }));
    return data.map((r: { name: string; available: boolean }) => ({ name: r.name, available: r.available }));
  } catch {
    return DEFAULT_CATEGORIES.map(name => ({ name, available: true }));
  }
}

export async function saveCategories(categories: Category[]): Promise<void> {
  try {
    let delQ = supabase.from('categories').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (_companyId) delQ = delQ.eq('company_id', _companyId);
    await delQ;
    await supabase.from('categories').insert(
      categories.map((c, position) => ({ name: c.name, available: c.available, position, company_id: _companyId }))
    );
  } catch (e) {
    console.error('[saveCategories]', e);
  }
}

// ─── Trash ────────────────────────────────────────────────────────────────────

export async function fetchTrash(): Promise<TrashItem[]> {
  try {
    await supabase.from('trash_items').delete().lt('deleted_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
    let q = supabase.from('trash_items').select('*').order('deleted_at', { ascending: false });
    if (_companyId) q = q.eq('company_id', _companyId);
    const { data, error } = await q;
    if (error || !data) return [];
    return data.map(r => ({ id: r.id, type: r.type, data: r.data, deletedAt: r.deleted_at }));
  } catch { return []; }
}

export async function moveToTrash(type: string, item: Record<string, unknown>): Promise<void> {
  try {
    await supabase.from('trash_items').insert({ type, data: item, company_id: _companyId });
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
    let q = supabase.from('orders').select('*, order_items(*)').order('created_at', { ascending: false });
    if (_companyId) q = q.eq('company_id', _companyId);
    const { data, error } = await q;
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
      tipAmount: o.tip_amount ? Number(o.tip_amount) : undefined,
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
      company_id: _companyId,
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
  tipAmount?: number,
): Promise<void> {
  const { error } = await supabase
    .from('orders')
    .update({ status, cash_amount: cashAmount ?? 0, card_amount: cardAmount ?? 0, tip_amount: tipAmount ?? 0 })
    .eq('id', orderId);
  if (error) console.error('[updateOrderStatus]', error.message);
}

// ─── Superadmin: Companies ────────────────────────────────────────────────────

export async function fetchCompanies(): Promise<{ id: string; name: string; slug: string; active: boolean; createdAt: string }[]> {
  try {
    const { data, error } = await supabase.from('companies').select('*').order('created_at');
    if (error || !data) return [];
    return data.map(c => ({ id: c.id, name: c.name, slug: c.slug, active: c.active, createdAt: c.created_at }));
  } catch { return []; }
}

export async function createCompany(name: string, slug: string): Promise<void> {
  try {
    await supabase.from('companies').insert({ name, slug });
  } catch (e) { console.error('[createCompany]', e); }
}

export async function deleteCompany(id: string): Promise<void> {
  try {
    await supabase.from('companies').delete().eq('id', id);
  } catch (e) { console.error('[deleteCompany]', e); }
}

export async function toggleCompanyActive(id: string, active: boolean): Promise<void> {
  try {
    await supabase.from('companies').update({ active }).eq('id', id);
  } catch (e) { console.error('[toggleCompanyActive]', e); }
}

// ─── Superadmin: Users ────────────────────────────────────────────────────────

export async function fetchAllUsers(): Promise<{ id: string; username: string; name: string; role: string; companyId: string | null; active: boolean; createdAt: string }[]> {
  try {
    const { data, error } = await supabase.from('users').select('*').order('created_at');
    if (error || !data) return [];
    return data.map(u => ({ id: u.id, username: u.username, name: u.name, role: u.role, companyId: u.company_id ?? null, active: u.active, createdAt: u.created_at }));
  } catch { return []; }
}

export async function createUser(username: string, password: string, name: string, role: string, companyId: string | null): Promise<string | null> {
  const { error } = await supabase.from('users').insert({ username, password, name, role, company_id: companyId });
  if (error) { console.error('[createUser]', error); return error.message; }
  return null;
}

export async function deleteUser(id: string): Promise<string | null> {
  const { error } = await supabase.from('users').delete().eq('id', id);
  if (error) { console.error('[deleteUser]', error); return error.message; }
  return null;
}

export async function toggleUserActive(id: string, active: boolean): Promise<void> {
  try {
    await supabase.from('users').update({ active }).eq('id', id);
  } catch (e) { console.error('[toggleUserActive]', e); }
}

export async function updateUser(id: string, name: string, password: string): Promise<void> {
  try {
    await supabase.from('users').update({ name, password }).eq('id', id);
  } catch (e) { console.error('[updateUser]', e); }
}

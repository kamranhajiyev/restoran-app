import { Category, MenuItem, Order, RestaurantTable, TrashItem } from '@/types';
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

export async function fetchOrders(opts?: { from?: string; to?: string; limit?: number }): Promise<Order[]> {
  try {
    // Total company-wide count so orderNumber stays stable regardless of range/limit
    let countQ = supabase.from('orders').select('*', { count: 'exact', head: true });
    if (_companyId) countQ = countQ.eq('company_id', _companyId);
    const { count: totalCount } = await countQ;

    // Supabase caps each response at 1000 rows — page until a short page comes back
    const PAGE = 1000;
    const all: Awaited<ReturnType<typeof runPage>> = [];
    async function runPage(start: number, end: number) {
      let q = supabase.from('orders').select('*, order_items(*)').order('created_at', { ascending: false }).range(start, end);
      if (_companyId) q = q.eq('company_id', _companyId);
      if (opts?.from) q = q.gte('created_at', opts.from);
      if (opts?.to) q = q.lte('created_at', opts.to);
      const { data, error } = await q;
      if (error || !data) throw error ?? new Error('fetchOrders: no data');
      return data;
    }
    for (let start = 0; ; start += PAGE) {
      const end = opts?.limit ? Math.min(start + PAGE, opts.limit) - 1 : start + PAGE - 1;
      const page = await runPage(start, end);
      all.push(...page);
      if (page.length < end - start + 1 || (opts?.limit && all.length >= opts.limit)) break;
    }
    return all.map((o, i) => ({
      id: o.id,
      orderNumber: (totalCount ?? all.length) - i,
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
    const { error: orderError } = await supabase.from('orders').insert({
      id: order.id,
      table_id: order.tableNumber === 0 ? null : order.tableNumber,
      waiter_name: order.sellerName,
      status: order.status,
      note: order.note ?? null,
      created_at: order.createdAt,
      company_id: _companyId,
    });
    if (orderError) { console.error('[addOrder orders]', orderError); return; }
    if (order.items.length === 0) return;
    const rows = order.items.map(oi => ({
      order_id: order.id,
      menu_item_id: String(oi.menuItem.id),
      menu_item_name: String(oi.menuItem.name),
      menu_item_price: Number(oi.menuItem.price),
      quantity: Number(oi.quantity),
      modifiers: oi.modifiers ?? null,
    }));
    const { error: itemsError } = await supabase.from('order_items').insert(rows);
    if (itemsError) console.error('[addOrder items]', itemsError);
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

// ─── Public: company by slug ──────────────────────────────────────────────────

export async function fetchCompanyBySlug(slug: string): Promise<{ id: string; name: string } | null> {
  try {
    const { data, error } = await supabase.from('companies').select('id, name').eq('slug', slug).eq('active', true).single();
    if (error || !data) return null;
    return { id: data.id, name: data.name };
  } catch { return null; }
}

export async function fetchCompanySlug(id: string): Promise<string | null> {
  try {
    const { data } = await supabase.from('companies').select('slug').eq('id', id).single();
    return data?.slug ?? null;
  } catch { return null; }
}

// ─── Tables ───────────────────────────────────────────────────────────────────

export async function fetchTables(): Promise<RestaurantTable[]> {
  try {
    let q = supabase.from('restaurant_tables').select('id, name, capacity, x, y, w, h, shape').order('id');
    if (_companyId) q = q.eq('company_id', _companyId);
    const { data, error } = await q;
    if (error || !data) return [];
    return data.map(r => ({
      id: r.id,
      name: r.name ?? `Masa ${r.id}`,
      capacity: r.capacity ?? 4,
      x: r.x ?? undefined,
      y: r.y ?? undefined,
      w: r.w ?? 100,
      h: r.h ?? 70,
      shape: (r.shape ?? 'rect') as 'rect' | 'round' | 'rect-v',
    }));
  } catch { return []; }
}

export async function createTable(name: string, capacity: number, shape: string = 'rect', w?: number, h?: number): Promise<string | null> {
  const { data, error } = await supabase
    .from('restaurant_tables')
    .insert({ name, capacity, shape, w: w ?? null, h: h ?? null, company_id: _companyId })
    .select('id')
    .single();
  if (error) { console.error('[createTable]', error); return error.message; }
  return null;
}

export async function updateTable(id: number, name: string, capacity: number): Promise<void> {
  try {
    await supabase.from('restaurant_tables').update({ name, capacity }).eq('id', id);
  } catch (e) { console.error('[updateTable]', e); }
}

export async function updateTableLayout(id: number, x: number, y: number, w: number, h: number, shape: string): Promise<void> {
  try {
    await supabase.from('restaurant_tables').update({ x, y, w, h, shape }).eq('id', id);
  } catch (e) { console.error('[updateTableLayout]', e); }
}

export async function deleteTable(id: number): Promise<string | null> {
  const { error } = await supabase.from('restaurant_tables').delete().eq('id', id);
  if (error) { console.error('[deleteTable]', error); return error.message; }
  return null;
}

// ─── Superadmin: Companies ────────────────────────────────────────────────────

export async function fetchCompanies(): Promise<{ id: string; name: string; slug: string; active: boolean; createdAt: string; expiresAt: string | null; ownerName: string | null; address: string | null; phone: string | null }[]> {
  try {
    const { data, error } = await supabase.from('companies').select('*').order('created_at');
    if (error || !data) return [];
    return data.map(c => ({ id: c.id, name: c.name, slug: c.slug, active: c.active, createdAt: c.created_at, expiresAt: c.expires_at ?? null, ownerName: c.owner_name ?? null, address: c.address ?? null, phone: c.phone ?? null }));
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

export async function fetchCompanyTrash(): Promise<TrashItem[]> {
  try {
    await supabase.from('trash_items').delete().eq('type', 'company').lt('deleted_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
    const { data, error } = await supabase.from('trash_items').select('*').eq('type', 'company').order('deleted_at', { ascending: false });
    if (error || !data) return [];
    return data.map(r => ({ id: r.id, type: r.type, data: r.data, deletedAt: r.deleted_at }));
  } catch { return []; }
}

export async function trashCompany(company: { id: string; name: string; slug: string; active: boolean; expiresAt: string | null; ownerName: string | null; address: string | null; phone: string | null }): Promise<void> {
  try {
    await supabase.from('trash_items').insert({ type: 'company', data: company, company_id: null });
    await supabase.from('companies').delete().eq('id', company.id);
  } catch (e) { console.error('[trashCompany]', e); }
}

export async function restoreCompany(item: TrashItem): Promise<void> {
  try {
    const c = item.data as Record<string, unknown>;
    await supabase.from('companies').insert({ id: c.id, name: c.name, slug: c.slug, active: c.active, expires_at: c.expiresAt ?? null, owner_name: c.ownerName ?? null, address: c.address ?? null, phone: c.phone ?? null });
    await supabase.from('trash_items').delete().eq('id', item.id);
  } catch (e) { console.error('[restoreCompany]', e); }
}

export async function permanentlyDeleteCompany(trashId: string, companyId: string): Promise<void> {
  try {
    await supabase.from('users').delete().eq('company_id', companyId);
    await supabase.from('trash_items').delete().eq('id', trashId);
  } catch (e) { console.error('[permanentlyDeleteCompany]', e); }
}

export async function toggleCompanyActive(id: string, active: boolean): Promise<void> {
  try {
    await supabase.from('companies').update({ active }).eq('id', id);
  } catch (e) { console.error('[toggleCompanyActive]', e); }
}

export async function updateCompanyName(id: string, name: string): Promise<void> {
  try {
    await supabase.from('companies').update({ name }).eq('id', id);
  } catch (e) { console.error('[updateCompanyName]', e); }
}

export async function updateCompanyExpiry(id: string, expiresAt: string | null): Promise<void> {
  try {
    await supabase.from('companies').update({ expires_at: expiresAt }).eq('id', id);
  } catch (e) { console.error('[updateCompanyExpiry]', e); }
}

export async function updateCompanyProfile(id: string, ownerName: string, address: string, phone: string): Promise<void> {
  try {
    await supabase.from('companies').update({ owner_name: ownerName, address, phone }).eq('id', id);
  } catch (e) { console.error('[updateCompanyProfile]', e); }
}

export async function fetchCompanyProfile(id: string): Promise<{ ownerName: string; address: string; phone: string } | null> {
  try {
    const { data, error } = await supabase.from('companies').select('owner_name, address, phone').eq('id', id).single();
    if (error || !data) return null;
    return { ownerName: data.owner_name ?? '', address: data.address ?? '', phone: data.phone ?? '' };
  } catch { return null; }
}

export async function verifyPassword(id: string, password: string): Promise<boolean> {
  try {
    const { data } = await supabase.from('users').select('id').eq('id', id).eq('password', password).single();
    return !!data;
  } catch { return false; }
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

export async function updateOwnerAccount(id: string, name: string, username: string, password?: string): Promise<string | null> {
  try {
    const updates: Record<string, unknown> = { name, username };
    if (password) updates.password = password;
    const { error } = await supabase.from('users').update(updates).eq('id', id);
    if (error) return error.message;
    return null;
  } catch (e) { console.error('[updateOwnerAccount]', e); return 'Xəta baş verdi'; }
}

import { CashShift, Category, MenuItem, Order, RestaurantTable, ShiftMovement, Staff, TrashItem } from '@/types';
import { CompanySettings, DEFAULT_SETTINGS, DEFAULT_TZ } from './business-day';
import { supabase } from './supabase';

async function authHeaders(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    'Content-Type': 'application/json',
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
  };
}

let _companyId: string | null = null;

export function setCompanyContext(id: string | null) {
  _companyId = id;
}

function isValidUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

// ─── Menu ─────────────────────────────────────────────────────────────────────

// Guards against the "failed fetch → empty screen → save wipes real data" chain:
// saves are refused until the corresponding fetch has succeeded at least once.
let _menuLoaded = false;
let _categoriesLoaded = false;

export async function fetchMenu(): Promise<MenuItem[]> {
  try {
    const { data, error } = await supabase.from('menu_items').select('*').order('position');
    if (error || !data) return [];
    _menuLoaded = true;
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

// Returns an error message (for the UI to show) or null on success — a failed
// save must never pass silently.
// Upsert-then-prune, NOT delete-then-insert: if the write fails, the existing
// rows are untouched. The old order (delete first) wiped the whole menu every
// time the insert was rejected (constraint conflict, RLS, network).
export async function saveMenu(menu: MenuItem[]): Promise<string | null> {
  if (!_companyId || !_menuLoaded) { console.error('[saveMenu] refused: no company context or menu never loaded'); return 'Menyu hələ yüklənməyib'; }
  try {
    // Dedupe by id — stale UI state can hold the same item twice (e.g. a double
    // trash-restore); one duplicate id would reject the entire write.
    const seen = new Set<string>();
    const rows: Record<string, unknown>[] = [];
    for (const m of menu) {
      const id = isValidUUID(m.id) ? m.id : crypto.randomUUID();
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push({
        id,
        name: m.name,
        price: m.price,
        category: m.category,
        available: m.available,
        variants: m.variants ?? null,
        cost_price: m.costPrice ?? null,
        image: m.image ?? null,
        cooking_station: m.cookingStation ?? null,
        position: rows.length,
        company_id: _companyId,
      });
    }
    if (rows.length > 0) {
      const { error } = await supabase.from('menu_items').upsert(rows, { onConflict: 'id' });
      if (error) { console.error('[saveMenu upsert]', error); return error.message; }
    }
    let del = supabase.from('menu_items').delete().eq('company_id', _companyId);
    if (rows.length > 0) del = del.not('id', 'in', `(${rows.map(r => `"${r.id}"`).join(',')})`);
    const { error: delError } = await del;
    if (delError) { console.error('[saveMenu prune]', delError); return delError.message; }
    return null;
  } catch (e) {
    console.error('[saveMenu]', e);
    return 'Şəbəkə xətası — menyu yadda saxlanmadı';
  }
}

export async function setMenuItemAvailable(id: string, available: boolean): Promise<void> {
  await supabase.from('menu_items').update({ available }).eq('id', id).eq('company_id', _companyId);
}

// ─── Categories ───────────────────────────────────────────────────────────────

// No placeholder fallback: a company with no categories sees an empty list and
// creates its own. The old default list ("Çay", "Snack", …) looked like real
// data and got persisted by the next save, polluting the company's categories.
export async function fetchCategories(): Promise<Category[]> {
  try {
    const { data, error } = await supabase.from('categories').select('name, available').order('position');
    if (error || !data) return [];
    _categoriesLoaded = true;
    return data.map((r: { name: string; available: boolean }) => ({ name: r.name, available: r.available }));
  } catch {
    return [];
  }
}

// Returns an error message (for the UI to show) or null on success.
// Same upsert-then-prune pattern as saveMenu — a failed write must not wipe.
export async function saveCategories(categories: Category[]): Promise<string | null> {
  if (!_companyId || !_categoriesLoaded) { console.error('[saveCategories] refused: no company context or categories never loaded'); return 'Kateqoriyalar hələ yüklənməyib'; }
  try {
    const seen = new Set<string>();
    const rows: { name: string; available: boolean; position: number; company_id: string }[] = [];
    for (const c of categories) {
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      rows.push({ name: c.name, available: c.available, position: rows.length, company_id: _companyId });
    }
    if (rows.length > 0) {
      const { error } = await supabase.from('categories').upsert(rows, { onConflict: 'company_id,name' });
      if (error) { console.error('[saveCategories upsert]', error); return error.message; }
    }
    let del = supabase.from('categories').delete().eq('company_id', _companyId);
    if (rows.length > 0) del = del.not('name', 'in', `(${rows.map(r => `"${r.name.replace(/"/g, '\\"')}"`).join(',')})`);
    const { error: delError } = await del;
    if (delError) { console.error('[saveCategories prune]', delError); return delError.message; }
    return null;
  } catch (e) {
    console.error('[saveCategories]', e);
    return 'Şəbəkə xətası — kateqoriyalar yadda saxlanmadı';
  }
}

// ─── Trash ────────────────────────────────────────────────────────────────────

export async function fetchTrash(): Promise<TrashItem[]> {
  try {
    if (_companyId) {
      await supabase.from('trash_items').delete().eq('company_id', _companyId)
        .lt('deleted_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
    }
    const { data, error } = await supabase.from('trash_items').select('*').order('deleted_at', { ascending: false });
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

export async function emptyTrash(): Promise<string | null> {
  if (!_companyId) return 'Şirkət konteksti yoxdur';
  try {
    const { error } = await supabase.from('trash_items').delete().eq('company_id', _companyId);
    if (error) { console.error('[emptyTrash]', error); return error.message; }
    return null;
  } catch (e) {
    console.error('[emptyTrash]', e);
    return 'Şəbəkə xətası — zibil qutusu boşaldılmadı';
  }
}

// ─── Orders ───────────────────────────────────────────────────────────────────

export async function fetchOrdersCount(): Promise<number> {
  try {
    const { count } = await supabase.from('orders').select('*', { count: 'exact', head: true });
    return count ?? 0;
  } catch { return 0; }
}

export async function fetchOrders(opts?: { from?: string; to?: string; limit?: number; offset?: number }): Promise<Order[]> {
  try {
    let countQ = supabase.from('orders').select('*', { count: 'exact', head: true });
    if (opts?.from) countQ = countQ.gte('created_at', opts.from);
    if (opts?.to) countQ = countQ.lte('created_at', opts.to);
    const { count: totalCount } = await countQ;

    const PAGE = 1000;
    const offset = opts?.offset ?? 0;
    const all: Awaited<ReturnType<typeof runPage>> = [];
    async function runPage(start: number, end: number) {
      let q = supabase.from('orders').select('*, order_items(*)').order('created_at', { ascending: false }).range(start, end);
      if (opts?.from) q = q.gte('created_at', opts.from);
      if (opts?.to) q = q.lte('created_at', opts.to);
      const { data, error } = await q;
      if (error || !data) throw error ?? new Error('fetchOrders: no data');
      return data;
    }
    for (let start = offset; ; start += PAGE) {
      const end = opts?.limit ? Math.min(start + PAGE, offset + opts.limit) - 1 : start + PAGE - 1;
      const page = await runPage(start, end);
      all.push(...page);
      if (page.length < end - start + 1 || (opts?.limit && all.length >= opts.limit)) break;
    }
    return all.map((o, i) => ({
      id: o.id,
      orderNumber: (totalCount ?? all.length) - offset - i,
      tableNumber: o.table_id ?? 0,
      sellerName: o.waiter_name,
      staffId: o.staff_id ?? undefined,
      status: o.status as Order['status'],
      note: o.note ?? undefined,
      createdAt: o.created_at,
      cashAmount: o.cash_amount ? Number(o.cash_amount) : undefined,
      cardAmount: o.card_amount ? Number(o.card_amount) : undefined,
      tipAmount: o.tip_amount ? Number(o.tip_amount) : undefined,
      changeAmount: o.change_amount ? Number(o.change_amount) : undefined,
      cancelledAt: o.cancelled_at ?? undefined,
      cancelledBy: o.cancelled_by ?? undefined,
      cancelReason: o.cancel_reason ?? undefined,
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
      staff_id: order.staffId ?? null,
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
  changeAmount?: number,
): Promise<boolean> {
  const updates: Record<string, unknown> = { status };
  // Plain status changes must not touch payment data
  const hasAmounts = cashAmount !== undefined || cardAmount !== undefined || tipAmount !== undefined || changeAmount !== undefined;
  if (hasAmounts) {
    updates.cash_amount = cashAmount ?? 0;
    updates.card_amount = cardAmount ?? 0;
    updates.tip_amount = tipAmount ?? 0;
    updates.change_amount = changeAmount ?? 0;
  }
  if (status === 'ödənilib') updates.paid_at = new Date().toISOString();
  let q = supabase.from('orders').update(updates).eq('id', orderId);
  // An order can only be paid once, and a cancelled order can't be paid or
  // revived — concurrent conflicting updates become no-ops
  if (status === 'ödənilib') q = q.neq('status', 'ödənilib');
  q = q.neq('status', 'ləğv edildi');
  const { data, error } = await q.select('id');
  if (error) { console.error('[updateOrderStatus]', error.message); return false; }
  return (data?.length ?? 0) > 0;
}

// Only unpaid orders can be cancelled — a paid order is final, mistakes after
// payment are for the owner to sort out manually.
export async function cancelOrder(orderId: string, reason: string, by: string): Promise<boolean> {
  const { data, error } = await supabase.from('orders')
    .update({
      status: 'ləğv edildi',
      cancelled_at: new Date().toISOString(),
      cancelled_by: by,
      cancel_reason: reason,
    })
    .eq('id', orderId)
    .neq('status', 'ödənilib')
    .neq('status', 'ləğv edildi')
    .select('id');
  if (error) { console.error('[cancelOrder]', error.message); return false; }
  return (data?.length ?? 0) > 0;
}

// ─── Staff (Poster-style PIN sellers) ────────────────────────────────────────
// Staff are not auth users: the terminal stays logged in and people identify
// themselves with a 4-digit PIN. All writes go through owner-only RPCs; the
// PIN is verified server-side (hashed, company-wide lockout on brute force).

export async function fetchStaff(): Promise<Staff[]> {
  try {
    const { data, error } = await supabase.from('staff')
      .select('id, name, active, created_at')
      .order('created_at');
    if (error || !data) return [];
    return data.map(s => ({ id: s.id, name: s.name, active: s.active, createdAt: s.created_at }));
  } catch { return []; }
}

// RPC errors carry machine codes (bad_pin, pin_taken, …); the UI translates them
function staffError(error: { message: string } | null): string | null {
  return error ? error.message : null;
}

export async function createStaff(name: string, pin: string): Promise<string | null> {
  const { error } = await supabase.rpc('create_staff', { p_name: name, p_pin: pin });
  return staffError(error);
}

export async function updateStaff(id: string, name: string, active: boolean): Promise<string | null> {
  const { error } = await supabase.rpc('update_staff', { p_id: id, p_name: name, p_active: active });
  return staffError(error);
}

export async function setStaffPin(id: string, pin: string): Promise<string | null> {
  const { error } = await supabase.rpc('set_staff_pin', { p_id: id, p_pin: pin });
  return staffError(error);
}

export async function deleteStaff(id: string): Promise<string | null> {
  const { error } = await supabase.rpc('delete_staff', { p_id: id });
  return staffError(error);
}

export type PinResult =
  | { ok: true; id: string; name: string }
  | { ok: false; error: 'wrong'; attemptsLeft: number }
  | { ok: false; error: 'locked'; lockedUntil: string }
  | { ok: false; error: 'no_company' | 'network' };

export async function verifyStaffPin(pin: string): Promise<PinResult> {
  try {
    const { data, error } = await supabase.rpc('verify_staff_pin', { p_pin: pin });
    if (error || !data) return { ok: false, error: 'network' };
    if (data.ok) return { ok: true, id: data.id, name: data.name };
    if (data.error === 'locked') return { ok: false, error: 'locked', lockedUntil: data.locked_until };
    if (data.error === 'wrong') return { ok: false, error: 'wrong', attemptsLeft: data.attempts_left ?? 0 };
    return { ok: false, error: 'no_company' };
  } catch { return { ok: false, error: 'network' }; }
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

// Takeaway-only companies turn tables off: sellers then skip table selection
// entirely and orders are created without a table.
export async function fetchTablesEnabled(): Promise<boolean> {
  try {
    if (!_companyId) return true;
    const { data, error } = await supabase.from('companies').select('tables_enabled').eq('id', _companyId).single();
    if (error || !data) return true;
    return data.tables_enabled !== false;
  } catch { return true; }
}

export async function setTablesEnabled(enabled: boolean): Promise<void> {
  // RLS allows only superadmins to update companies — owners flip this flag
  // through a security definer RPC scoped to their own company.
  const { error } = await supabase.rpc('set_tables_enabled', { enabled });
  if (error) console.error('[setTablesEnabled]', error);
}

export async function fetchTables(): Promise<RestaurantTable[]> {
  try {
    const { data, error } = await supabase.from('restaurant_tables').select('id, name, capacity, x, y, w, h, shape').order('id');
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

export async function fetchCompanies(): Promise<{ id: string; name: string; slug: string; active: boolean; createdAt: string; expiresAt: string | null; ownerName: string | null; address: string | null; phone: string | null; timezone: string }[]> {
  try {
    const { data, error } = await supabase.from('companies').select('*').is('trashed_at', null).order('created_at');
    if (error || !data) return [];
    return data.map(c => ({ id: c.id, name: c.name, slug: c.slug, active: c.active, createdAt: c.created_at, expiresAt: c.expires_at ?? null, ownerName: c.owner_name ?? null, address: c.address ?? null, phone: c.phone ?? null, timezone: c.timezone || DEFAULT_TZ }));
  } catch { return []; }
}

export async function createCompany(name: string, slug: string): Promise<void> {
  try {
    await supabase.from('companies').insert({ name, slug });
  } catch (e) { console.error('[createCompany]', e); }
}

// Trash = soft delete. The company row and ALL its data (profiles, menu,
// orders, tables, shifts) stay untouched; only trashed_at is set. Real
// deletion happens solely in permanentlyDeleteCompany.
export async function fetchCompanyTrash(): Promise<TrashItem[]> {
  try {
    // auto-purge: anything in the bin longer than 30 days is gone for good
    await supabase.from('companies').delete().not('trashed_at', 'is', null).lt('trashed_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
    const { data, error } = await supabase.from('companies').select('*').not('trashed_at', 'is', null).order('trashed_at', { ascending: false });
    if (error || !data) return [];
    return data.map(c => ({
      id: c.id,
      type: 'company',
      data: { id: c.id, name: c.name, slug: c.slug, active: c.active, expiresAt: c.expires_at ?? null, ownerName: c.owner_name ?? null, address: c.address ?? null, phone: c.phone ?? null, timezone: c.timezone || DEFAULT_TZ },
      deletedAt: c.trashed_at,
    }));
  } catch { return []; }
}

export async function trashCompany(companyId: string): Promise<string | null> {
  const { error } = await supabase.from('companies').update({ trashed_at: new Date().toISOString() }).eq('id', companyId);
  if (error) { console.error('[trashCompany]', error); return error.message; }
  return null;
}

export async function restoreCompany(item: TrashItem): Promise<void> {
  const { error } = await supabase.from('companies').update({ trashed_at: null }).eq('id', item.id);
  if (error) console.error('[restoreCompany]', error);
}

export async function permanentlyDeleteCompany(companyId: string): Promise<string | null> {
  const { error } = await supabase.from('companies').delete().eq('id', companyId);
  if (error) { console.error('[permanentlyDeleteCompany]', error); return error.message; }
  return null;
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

// Owner's own profile save — direct updates to companies are superadmin-only
// under RLS, so owners go through a security definer RPC like set_work_hours.
export async function updateMyCompanyProfile(ownerName: string, address: string, phone: string): Promise<void> {
  const { error } = await supabase.rpc('set_company_profile', { owner_name_t: ownerName, address_t: address, phone_t: phone });
  if (error) console.error('[updateMyCompanyProfile]', error);
}

// Timezone + working hours drive how the statistics "business day" is computed
export async function fetchCompanySettings(id: string): Promise<CompanySettings> {
  try {
    const { data, error } = await supabase.from('companies').select('timezone, work_open, work_close').eq('id', id).single();
    if (error || !data) return DEFAULT_SETTINGS;
    return {
      timezone: data.timezone || DEFAULT_TZ,
      workOpen: data.work_open || '00:00',
      workClose: data.work_close || '00:00',
    };
  } catch { return DEFAULT_SETTINGS; }
}

export async function updateCompanyHours(workOpen: string, workClose: string): Promise<void> {
  // RLS allows only superadmins to update companies — owners set their working
  // hours through a security definer RPC scoped to their own company.
  const { error } = await supabase.rpc('set_work_hours', { open_t: workOpen, close_t: workClose });
  if (error) console.error('[updateCompanyHours]', error);
}

export async function updateCompanyTimezone(id: string, timezone: string): Promise<void> {
  try {
    await supabase.from('companies').update({ timezone }).eq('id', id);
  } catch (e) { console.error('[updateCompanyTimezone]', e); }
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
    const res = await fetch('/api/users/verify-password', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ id, password }),
    });
    const { valid } = await res.json();
    return !!valid;
  } catch { return false; }
}

// ─── Login events ─────────────────────────────────────────────────────────────

export interface LoginEvent {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  name: string;
  username: string;
  role: string;
}

export async function fetchLoginEvents(): Promise<LoginEvent[]> {
  try {
    const res = await fetch('/api/login-events', { headers: await authHeaders() });
    if (!res.ok) return [];
    const data = await res.json();
    return data.map((e: Record<string, unknown>) => {
      const p = (e.profiles ?? {}) as Record<string, unknown>;
      return {
        id: e.id,
        ip: e.ip ?? null,
        userAgent: e.user_agent ?? null,
        createdAt: e.created_at,
        name: p.name ?? '—',
        username: p.username ?? '',
        role: p.role ?? '',
      };
    });
  } catch { return []; }
}

// ─── Superadmin: Users ────────────────────────────────────────────────────────

export async function fetchAllUsers(): Promise<{ id: string; username: string; name: string; role: string; companyId: string | null; active: boolean; createdAt: string }[]> {
  try {
    const res = await fetch('/api/users', { headers: await authHeaders() });
    if (!res.ok) return [];
    const data = await res.json();
    return data.map((u: Record<string, unknown>) => ({ id: u.id, username: u.username, name: u.name, role: u.role, companyId: u.company_id ?? null, active: u.active, createdAt: u.created_at }));
  } catch { return []; }
}

export async function createUser(username: string, password: string, name: string, role: string, companyId: string | null): Promise<string | null> {
  const res = await fetch('/api/users', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ username, password, name, role, companyId }),
  });
  if (!res.ok) {
    const { error } = await res.json();
    return error ?? 'Xəta baş verdi';
  }
  return null;
}

export async function deleteUser(id: string): Promise<string | null> {
  const res = await fetch(`/api/users/${id}`, { method: 'DELETE', headers: await authHeaders() });
  if (!res.ok) {
    const { error } = await res.json();
    return error ?? 'Xəta baş verdi';
  }
  return null;
}

export async function toggleUserActive(id: string, active: boolean): Promise<void> {
  await fetch(`/api/users/${id}`, {
    method: 'PATCH',
    headers: await authHeaders(),
    body: JSON.stringify({ active }),
  });
}

export async function updateUser(id: string, name: string, password: string): Promise<void> {
  await fetch(`/api/users/${id}`, {
    method: 'PATCH',
    headers: await authHeaders(),
    body: JSON.stringify({ name, password }),
  });
}

export async function updateOwnerAccount(id: string, name: string, username: string, password?: string): Promise<string | null> {
  const res = await fetch(`/api/users/${id}`, {
    method: 'PATCH',
    headers: await authHeaders(),
    body: JSON.stringify({ name, username, ...(password ? { password } : {}) }),
  });
  if (!res.ok) {
    const { error } = await res.json();
    return error ?? 'Xəta baş verdi';
  }
  return null;
}

// ─── Cash shifts (kassa) ──────────────────────────────────────────────────────

function mapShift(r: {
  id: string; opened_at: string; opened_by: string; opening_cash: number;
  closed_at: string | null; closed_by: string | null;
  expected_cash: number | null; counted_cash: number | null;
  card_sales: number | null; counted_card: number | null; movements: unknown;
}): CashShift {
  return {
    id: r.id,
    openedAt: r.opened_at,
    openedBy: r.opened_by,
    openingCash: Number(r.opening_cash),
    closedAt: r.closed_at ?? undefined,
    closedBy: r.closed_by ?? undefined,
    expectedCash: r.expected_cash !== null ? Number(r.expected_cash) : undefined,
    countedCash: r.counted_cash !== null ? Number(r.counted_cash) : undefined,
    cardSales: r.card_sales !== null ? Number(r.card_sales) : undefined,
    countedCard: r.counted_card !== null ? Number(r.counted_card) : undefined,
    movements: Array.isArray(r.movements) ? (r.movements as ShiftMovement[]) : [],
  };
}

export async function fetchOpenShift(): Promise<CashShift | null> {
  try {
    const { data, error } = await supabase
      .from('cash_shifts').select('*')
      .is('closed_at', null)
      .order('opened_at', { ascending: false })
      .limit(1).maybeSingle();
    if (error || !data) return null;
    return mapShift(data);
  } catch { return null; }
}

export async function fetchShifts(limit = 60): Promise<CashShift[]> {
  try {
    const { data, error } = await supabase
      .from('cash_shifts').select('*')
      .order('opened_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data.map(mapShift);
  } catch { return []; }
}

export async function openShift(openingCash: number, openedBy: string): Promise<CashShift | null> {
  const { data, error } = await supabase
    .from('cash_shifts')
    .insert({ company_id: _companyId, opening_cash: openingCash, opened_by: openedBy })
    .select('*').single();
  if (error || !data) {
    // Unique index allows one open shift per company — if someone else just
    // opened one, join theirs instead of failing
    const existing = await fetchOpenShift();
    if (existing) return existing;
    console.error('[openShift]', error);
    return null;
  }
  return mapShift(data);
}

export async function addShiftMovement(shiftId: string, movement: ShiftMovement): Promise<void> {
  // Atomic jsonb append in the DB — concurrent movements can't overwrite each other
  const { error } = await supabase.rpc('append_shift_movement', { shift_id: shiftId, movement });
  if (error) console.error('[addShiftMovement]', error);
}

export async function closeShift(
  shiftId: string, expectedCash: number, countedCash: number, closedBy: string,
  cardSales?: number, countedCard?: number,
): Promise<void> {
  const { error } = await supabase
    .from('cash_shifts')
    .update({
      closed_at: new Date().toISOString(), closed_by: closedBy,
      expected_cash: expectedCash, counted_cash: countedCash,
      card_sales: cardSales ?? null, counted_card: countedCard ?? null,
    })
    .eq('id', shiftId);
  if (error) console.error('[closeShift]', error);
}

// Cash/card taken since the shift opened (paid orders only, by payment time —
// an order created yesterday but paid during this shift counts). cash_amount is
// net of change and includes tips — i.e. exactly what went into the drawer.
export async function fetchShiftSales(openedAt: string): Promise<{ cash: number; card: number }> {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('cash_amount, card_amount')
      .eq('status', 'ödənilib')
      .gte('paid_at', openedAt);
    if (error || !data) return { cash: 0, card: 0 };
    return {
      cash: data.reduce((s, o) => s + Number(o.cash_amount ?? 0), 0),
      card: data.reduce((s, o) => s + Number(o.card_amount ?? 0), 0),
    };
  } catch { return { cash: 0, card: 0 }; }
}

import { CashShift, Category, MenuItem, Order, RestaurantTable, ShiftMovement, TrashItem } from '@/types';
import { supabase } from './supabase';

const DEFAULT_CATEGORIES = ['Çay', 'Soyuq içkilər', 'Şirniyyat', 'Snack', 'Xüsusi'];

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

export async function saveMenu(menu: MenuItem[]): Promise<void> {
  if (!_companyId || !_menuLoaded) { console.error('[saveMenu] refused: no company context or menu never loaded'); return; }
  try {
    await supabase.from('menu_items').delete().eq('company_id', _companyId);
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
    const { data, error } = await supabase.from('categories').select('name, available').order('position');
    if (error || !data) return DEFAULT_CATEGORIES.map(name => ({ name, available: true }));
    _categoriesLoaded = true;
    if (data.length === 0) return DEFAULT_CATEGORIES.map(name => ({ name, available: true }));
    return data.map((r: { name: string; available: boolean }) => ({ name: r.name, available: r.available }));
  } catch {
    return DEFAULT_CATEGORIES.map(name => ({ name, available: true }));
  }
}

export async function saveCategories(categories: Category[]): Promise<void> {
  if (!_companyId || !_categoriesLoaded) { console.error('[saveCategories] refused: no company context or categories never loaded'); return; }
  try {
    await supabase.from('categories').delete().eq('company_id', _companyId);
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
      status: o.status as Order['status'],
      note: o.note ?? undefined,
      createdAt: o.created_at,
      cashAmount: o.cash_amount ? Number(o.cash_amount) : undefined,
      cardAmount: o.card_amount ? Number(o.card_amount) : undefined,
      tipAmount: o.tip_amount ? Number(o.tip_amount) : undefined,
      changeAmount: o.change_amount ? Number(o.change_amount) : undefined,
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
  // An order can only be paid once — second concurrent payment is a no-op
  if (status === 'ödənilib') q = q.neq('status', 'ödənilib');
  const { data, error } = await q.select('id');
  if (error) { console.error('[updateOrderStatus]', error.message); return false; }
  return (data?.length ?? 0) > 0;
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
    await supabase.from('profiles').delete().eq('company_id', companyId);
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
    const res = await fetch('/api/users/verify-password', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ id, password }),
    });
    const { valid } = await res.json();
    return !!valid;
  } catch { return false; }
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
  expected_cash: number | null; counted_cash: number | null; movements: unknown;
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

export async function closeShift(shiftId: string, expectedCash: number, countedCash: number, closedBy: string): Promise<void> {
  const { error } = await supabase
    .from('cash_shifts')
    .update({ closed_at: new Date().toISOString(), closed_by: closedBy, expected_cash: expectedCash, counted_cash: countedCash })
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

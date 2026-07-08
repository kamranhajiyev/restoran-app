import { CashShift, Category, MenuItem, Order, OrderItem, ReceiptLine, ReceiptLineDetail, RecipeIngredient, RecipeLineRow, RestaurantTable, ShiftMovement, Staff, StockBalance, StockItem, StockMovement, StockReceipt, Supplier, SupplierLedger, TrashItem, Warehouse, WriteoffEntry } from '@/types';
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
      kind: r.kind ?? 'product',
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
        kind: m.kind ?? 'product',
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
    return all.map((o) => ({
      id: o.id,
      orderNumber: o.order_number ?? 0,
      tableNumber: o.table_id ?? 0,
      sellerName: o.waiter_name,
      staffId: o.staff_id ?? undefined,
      status: o.status as Order['status'],
      note: o.note ?? undefined,
      createdAt: o.created_at,
      cashAmount: o.cash_amount ? Number(o.cash_amount) : undefined,
      cardAmount: o.card_amount ? Number(o.card_amount) : undefined,
      changeAmount: o.change_amount ? Number(o.change_amount) : undefined,
      discountAmount: o.discount_amount ? Number(o.discount_amount) : undefined,
      discountType: (o.discount_type as '%' | '₼') ?? undefined,
      cancelledAt: o.cancelled_at ?? undefined,
      cancelledBy: o.cancelled_by ?? undefined,
      cancelReason: o.cancel_reason ?? undefined,
      items: (o.order_items ?? []).map((oi: { menu_item_id: string; menu_item_name: string; menu_item_price: number; quantity: number; modifiers?: string; variant_id?: string }) => ({
        menuItem: {
          id: oi.menu_item_id,
          name: oi.menu_item_name,
          price: Number(oi.menu_item_price),
          category: '',
          available: true,
        },
        quantity: oi.quantity,
        modifiers: oi.modifiers ?? undefined,
        variantId: oi.variant_id ?? undefined,
      })),
    }));
  } catch {
    return [];
  }
}

export async function addOrder(order: Order): Promise<string | null> {
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
    if (orderError) { console.error('[addOrder orders]', orderError); return orderError.message; }
    if (order.items.length === 0) return null;
    const rows = order.items.map(oi => ({
      order_id: order.id,
      menu_item_id: String(oi.menuItem.id),
      menu_item_name: String(oi.menuItem.name),
      menu_item_price: Number(oi.menuItem.price),
      quantity: Number(oi.quantity),
      modifiers: oi.modifiers ?? null,
      variant_id: oi.variantId ?? null,
    }));
    const { error: itemsError } = await supabase.from('order_items').insert(rows);
    if (itemsError) { console.error('[addOrder items]', itemsError); return itemsError.message; }
    return null;
  } catch (e) {
    console.error('[addOrder]', e);
    return e instanceof Error ? e.message : 'Bilinməyən xəta';
  }
}

export async function addItemsToOrder(orderId: string, items: OrderItem[], note?: string | null): Promise<string | null> {
  try {
    // Refuse to append to an order that's already closed (paid/cancelled/deleted) —
    // matches the public API route and the conditional pay/cancel flows.
    const { data: ord, error: ordError } = await supabase
      .from('orders').select('status').eq('id', orderId).eq('company_id', _companyId).single();
    if (ordError || !ord) { console.error('[addItemsToOrder order]', ordError); return ordError?.message ?? 'closed'; }
    if (['ödənilib', 'ləğv edildi', 'silinib'].includes(ord.status)) return 'closed';

    if (items.length > 0) {
      const rows = items.map(oi => ({
        order_id: orderId,
        menu_item_id: String(oi.menuItem.id),
        menu_item_name: String(oi.menuItem.name),
        menu_item_price: Number(oi.menuItem.price),
        quantity: Number(oi.quantity),
        modifiers: oi.modifiers ?? null,
        variant_id: oi.variantId ?? null,
      }));
      const { error } = await supabase.from('order_items').insert(rows);
      if (error) { console.error('[addItemsToOrder]', error); return error.message; }
    }
    if (note !== undefined) {
      const { error: noteError } = await supabase.from('orders').update({ note: note || null }).eq('id', orderId).eq('company_id', _companyId);
      if (noteError) { console.error('[addItemsToOrder note]', noteError); return noteError.message; }
    }
    return null;
  } catch (e) {
    console.error('[addItemsToOrder]', e);
    return e instanceof Error ? e.message : 'Bilinməyən xəta';
  }
}

export async function updateOrderStatus(
  orderId: string,
  status: Order['status'],
  cashAmount?: number,
  cardAmount?: number,
  changeAmount?: number,
  discountAmount?: number,
  discountType?: '%' | '₼',
): Promise<boolean> {
  const updates: Record<string, unknown> = { status };
  // Plain status changes must not touch payment data
  const hasAmounts = cashAmount !== undefined || cardAmount !== undefined || changeAmount !== undefined;
  if (hasAmounts) {
    updates.cash_amount = cashAmount ?? 0;
    updates.card_amount = cardAmount ?? 0;
    updates.change_amount = changeAmount ?? 0;
    updates.discount_amount = discountAmount ?? 0;
    updates.discount_type = discountType ?? '₼';
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

export async function deleteOrder(orderId: string): Promise<boolean> {
  const { error } = await supabase.from('orders').update({ status: 'silinib' }).eq('id', orderId);
  if (error) { console.error('[deleteOrder]', error.message); return false; }
  return true;
}

export async function restoreOrder(orderId: string, status: 'ödənilib' | 'ləğv edildi'): Promise<boolean> {
  const { error } = await supabase.from('orders').update({ status }).eq('id', orderId);
  if (error) { console.error('[restoreOrder]', error.message); return false; }
  return true;
}

export async function editOrderPayment(orderId: string, cashAmount: number, cardAmount: number): Promise<boolean> {
  const { error } = await supabase.from('orders')
    .update({ cash_amount: cashAmount, card_amount: cardAmount, change_amount: 0 })
    .eq('id', orderId);
  if (error) { console.error('[editOrderPayment]', error.message); return false; }
  return true;
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

// ─── Anbar (warehouse / inventory) ────────────────────────────────────────────
// Catalog tables (warehouses/suppliers/stock_items) are CRUD'd directly under
// RLS. Stock changes (receipt/write-off/recount) go through SECURITY DEFINER
// RPCs so the ledger and cached balances stay atomic — same pattern as staff.

export async function fetchWarehouses(): Promise<Warehouse[]> {
  try {
    const { data, error } = await supabase.from('warehouses')
      .select('id, name, active, created_at').order('created_at');
    if (error || !data) return [];
    return data.map(w => ({ id: w.id, name: w.name, active: w.active, createdAt: w.created_at }));
  } catch { return []; }
}

export async function createWarehouse(name: string): Promise<string | null> {
  const { error } = await supabase.from('warehouses').insert({ name, company_id: _companyId });
  if (error) { console.error('[createWarehouse]', error); return error.message; }
  return null;
}

export async function updateWarehouse(id: string, name: string, active: boolean): Promise<string | null> {
  const { error } = await supabase.from('warehouses').update({ name, active }).eq('id', id);
  if (error) { console.error('[updateWarehouse]', error); return error.message; }
  return null;
}

export async function deleteWarehouse(id: string): Promise<string | null> {
  const { error } = await supabase.from('warehouses').delete().eq('id', id);
  if (error) { console.error('[deleteWarehouse]', error); return error.message; }
  return null;
}

export async function fetchSuppliers(): Promise<Supplier[]> {
  try {
    const { data, error } = await supabase.from('suppliers')
      .select('id, name, address, phone, note, active, created_at').order('created_at');
    if (error || !data) return [];
    return data.map(s => ({
      id: s.id, name: s.name, address: s.address ?? undefined, phone: s.phone ?? undefined,
      note: s.note ?? undefined, active: s.active, createdAt: s.created_at,
    }));
  } catch { return []; }
}

export async function createSupplier(name: string, address: string, phone: string, note: string): Promise<string | null> {
  const { error } = await supabase.from('suppliers').insert({
    name, address: address || null, phone: phone || null, note: note || null, company_id: _companyId,
  });
  if (error) { console.error('[createSupplier]', error); return error.message; }
  return null;
}

export async function updateSupplier(id: string, name: string, address: string, phone: string, note: string, active: boolean): Promise<string | null> {
  const { error } = await supabase.from('suppliers')
    .update({ name, address: address || null, phone: phone || null, note: note || null, active }).eq('id', id);
  if (error) { console.error('[updateSupplier]', error); return error.message; }
  return null;
}

export async function deleteSupplier(id: string): Promise<string | null> {
  const { error } = await supabase.from('suppliers').delete().eq('id', id);
  if (error) { console.error('[deleteSupplier]', error); return error.message; }
  return null;
}

export async function fetchStockItems(): Promise<StockItem[]> {
  try {
    const { data, error } = await supabase.from('stock_items')
      .select('id, name, unit, type, created_at')
      .is('trashed_at', null)   // hide products whose menu item was deleted
      .order('name');
    if (error || !data) return [];
    return data.map(s => ({ id: s.id, name: s.name, unit: s.unit, type: s.type ?? 'ingredient', createdAt: s.created_at }));
  } catch { return []; }
}

export async function createStockItem(name: string, unit: string, type: 'product' | 'ingredient' = 'ingredient'): Promise<string | null> {
  const { error } = await supabase.from('stock_items').insert({ name, unit, type, company_id: _companyId });
  if (error) { console.error('[createStockItem]', error); return error.message; }
  return null;
}

export async function updateStockItem(id: string, name: string, unit: string, type?: 'product' | 'ingredient'): Promise<string | null> {
  const patch: Record<string, unknown> = { name, unit };
  if (type) patch.type = type;
  const { error } = await supabase.from('stock_items').update(patch).eq('id', id);
  if (error) { console.error('[updateStockItem]', error); return error.message; }
  return null;
}

export async function deleteStockItem(id: string): Promise<string | null> {
  const { error } = await supabase.from('stock_items').delete().eq('id', id);
  if (error) { console.error('[deleteStockItem]', error); return error.message; }
  return null;
}

// Qalıqlar: current balances joined with item name/unit. Optionally one warehouse.
export async function fetchBalances(warehouseId?: string): Promise<StockBalance[]> {
  try {
    // !inner + trashed_at filter drops balances of hidden (deleted-menu) products from Qalıqlar.
    let q = supabase.from('stock_balances')
      .select('warehouse_id, stock_item_id, qty, stock_items!inner(name, unit)')
      .is('stock_items.trashed_at', null);
    if (warehouseId) q = q.eq('warehouse_id', warehouseId);
    const { data, error } = await q;
    if (error || !data) return [];
    return data.map((b: Record<string, unknown>) => {
      const si = (b.stock_items ?? {}) as { name?: string; unit?: string };
      return {
        warehouseId: b.warehouse_id as string,
        stockItemId: b.stock_item_id as string,
        name: si.name ?? '',
        unit: si.unit ?? '',
        qty: Number(b.qty ?? 0),
      };
    });
  } catch { return []; }
}

export async function fetchReceipts(): Promise<StockReceipt[]> {
  try {
    const { data, error } = await supabase.from('stock_receipts')
      .select('id, warehouse_id, supplier_id, total, paid_amount, note, created_by, created_at, voided_at, voided_by')
      .order('created_at', { ascending: false }).limit(200);
    if (error || !data) return [];
    return data.map(r => ({
      id: r.id, warehouseId: r.warehouse_id, supplierId: r.supplier_id ?? undefined,
      total: Number(r.total), paidAmount: Number(r.paid_amount ?? 0),
      note: r.note ?? undefined, createdBy: r.created_by ?? undefined, createdAt: r.created_at,
      voidedAt: r.voided_at ?? undefined, voidedBy: r.voided_by ?? undefined,
    }));
  } catch { return []; }
}

export async function fetchMovements(stockItemId: string): Promise<StockMovement[]> {
  try {
    const { data, error } = await supabase.from('stock_movements')
      .select('id, warehouse_id, stock_item_id, qty, reason, unit_cost, receipt_id, created_by, created_at')
      .eq('stock_item_id', stockItemId).order('created_at', { ascending: false }).limit(200);
    if (error || !data) return [];
    return data.map(m => ({
      id: m.id, warehouseId: m.warehouse_id, stockItemId: m.stock_item_id, qty: Number(m.qty),
      reason: m.reason as StockMovement['reason'], unitCost: m.unit_cost !== null ? Number(m.unit_cost) : undefined,
      receiptId: m.receipt_id ?? undefined, createdBy: m.created_by ?? undefined, createdAt: m.created_at,
    }));
  } catch { return []; }
}

export async function recordReceipt(warehouseId: string, supplierId: string | null, lines: ReceiptLine[], note: string, paidAmount = 0): Promise<string | null> {
  const { error } = await supabase.rpc('record_receipt', {
    p_warehouse_id: warehouseId,
    p_supplier_id: supplierId,
    p_lines: lines.map(l => ({ stock_item_id: l.stockItemId, qty: l.qty, unit_cost: l.unitCost ?? null })),
    p_note: note || null,
    p_paid_amount: paidAmount || 0,
  });
  if (error) { console.error('[recordReceipt]', error); return error.message; }
  return null;
}

// Edit a purchase in place: reverses old lines and reinserts the new ones (same row id).
export async function updateReceipt(receiptId: string, warehouseId: string, supplierId: string | null, lines: ReceiptLine[], note: string, paidAmount = 0): Promise<string | null> {
  const { error } = await supabase.rpc('update_receipt', {
    p_receipt_id: receiptId,
    p_warehouse_id: warehouseId,
    p_supplier_id: supplierId,
    p_lines: lines.map(l => ({ stock_item_id: l.stockItemId, qty: l.qty, unit_cost: l.unitCost ?? null })),
    p_note: note || null,
    p_paid_amount: paidAmount || 0,
  });
  if (error) { console.error('[updateReceipt]', error); return error.message; }
  return null;
}

// Soft-delete a purchase: reverses its stock, keeps the row (shown red). Idempotent.
export async function voidReceipt(receiptId: string): Promise<string | null> {
  const { error } = await supabase.rpc('void_receipt', { p_receipt_id: receiptId });
  if (error) { console.error('[voidReceipt]', error); return error.message; }
  return null;
}

// The lines of one existing purchase, reconstructed from its stock_movements.
export async function fetchReceiptLines(receiptId: string): Promise<ReceiptLineDetail[]> {
  try {
    const { data, error } = await supabase.from('stock_movements')
      .select('stock_item_id, qty, unit_cost, stock_items(name, unit)')
      .eq('receipt_id', receiptId).eq('reason', 'receipt');
    if (error || !data) return [];
    return data.map((m: Record<string, unknown>) => {
      const si = (m.stock_items ?? {}) as { name?: string; unit?: string };
      return {
        stockItemId: m.stock_item_id as string,
        name: si.name ?? '',
        unit: si.unit ?? '',
        qty: Number(m.qty ?? 0),
        unitCost: m.unit_cost !== null && m.unit_cost !== undefined ? Number(m.unit_cost) : undefined,
      };
    });
  } catch { return []; }
}

// The Silinmələr log: every write-off, newest first, with item + warehouse names.
export async function fetchWriteoffs(): Promise<WriteoffEntry[]> {
  try {
    const { data, error } = await supabase.from('stock_movements')
      .select('id, warehouse_id, stock_item_id, qty, note, created_by, created_at, stock_items(name, unit), warehouses(name)')
      .eq('reason', 'writeoff').order('created_at', { ascending: false }).limit(300);
    if (error || !data) return [];
    return data.map((m: Record<string, unknown>) => {
      const si = (m.stock_items ?? {}) as { name?: string; unit?: string };
      const wh = (m.warehouses ?? {}) as { name?: string };
      return {
        id: m.id as string,
        warehouseId: m.warehouse_id as string,
        warehouseName: wh.name ?? '—',
        stockItemId: m.stock_item_id as string,
        name: si.name ?? '',
        unit: si.unit ?? '',
        qty: Math.abs(Number(m.qty ?? 0)),
        reason: (m.note as string | null) ?? undefined,
        createdBy: (m.created_by as string | null) ?? undefined,
        createdAt: m.created_at as string,
      };
    });
  } catch { return []; }
}

// Standalone supplier payment (pay-later against accumulated debt).
export async function addSupplierPayment(supplierId: string, amount: number, note: string): Promise<string | null> {
  const { error } = await supabase.rpc('add_supplier_payment', {
    p_supplier_id: supplierId, p_amount: amount, p_note: note || null,
  });
  if (error) { console.error('[addSupplierPayment]', error); return error.message; }
  return null;
}

// Per-supplier total of standalone payments (the Ödəniş box), summed by supplier.
// Used to net these payments against individual receipts in the Bazarlıqlar view.
export async function fetchSupplierPayments(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  try {
    const { data } = await supabase.from('supplier_payments').select('supplier_id, amount');
    for (const p of data ?? []) {
      if (!p.supplier_id) continue;
      out[p.supplier_id] = (out[p.supplier_id] ?? 0) + Number(p.amount ?? 0);
    }
  } catch { /* ignore */ }
  return out;
}

// Per-supplier money summary: total purchased (non-voided), paid, and outstanding debt.
export async function fetchSupplierLedger(): Promise<Record<string, SupplierLedger>> {
  const out: Record<string, SupplierLedger> = {};
  const ensure = (id: string) => (out[id] ??= { total: 0, paid: 0, debt: 0 });
  try {
    const [receipts, payments] = await Promise.all([
      supabase.from('stock_receipts').select('supplier_id, total, paid_amount, voided_at'),
      supabase.from('supplier_payments').select('supplier_id, amount'),
    ]);
    for (const r of receipts.data ?? []) {
      if (!r.supplier_id || r.voided_at) continue;
      const l = ensure(r.supplier_id);
      l.total += Number(r.total ?? 0);
      l.paid += Number(r.paid_amount ?? 0);
    }
    for (const p of payments.data ?? []) {
      if (!p.supplier_id) continue;
      ensure(p.supplier_id).paid += Number(p.amount ?? 0);
    }
    for (const id of Object.keys(out)) out[id].debt = out[id].total - out[id].paid;
    return out;
  } catch { return out; }
}

export async function recordWriteoff(warehouseId: string, stockItemId: string, qty: number, reason: string): Promise<string | null> {
  const { error } = await supabase.rpc('record_writeoff', {
    p_warehouse_id: warehouseId, p_stock_item_id: stockItemId, p_qty: qty, p_reason: reason || null,
  });
  if (error) { console.error('[recordWriteoff]', error); return error.message; }
  return null;
}

export async function recordCount(warehouseId: string, stockItemId: string, countedQty: number): Promise<string | null> {
  const { error } = await supabase.rpc('record_count', {
    p_warehouse_id: warehouseId, p_stock_item_id: stockItemId, p_counted_qty: countedQty,
  });
  if (error) { console.error('[recordCount]', error); return error.message; }
  return null;
}

// ─── Anbar Phase 2: recipes + sales warehouse ─────────────────────────────────
// A menu item "has a recipe" when it has >=1 recipe_lines row. Selling a paid
// order deducts each ingredient × quantity from the company's sales warehouse
// (handled by a DB trigger, not here).

export async function fetchRecipeLines(): Promise<RecipeLineRow[]> {
  try {
    const { data, error } = await supabase.from('recipe_lines').select('menu_item_id, stock_item_id, qty');
    if (error || !data) return [];
    return data.map(r => ({ menuItemId: r.menu_item_id, stockItemId: r.stock_item_id, qty: Number(r.qty) }));
  } catch { return []; }
}

// Replace one menu item's recipe with `lines`. Upsert-then-prune so a failed
// write never wipes the existing recipe (same safety as saveMenu).
export async function saveRecipe(menuItemId: string, lines: RecipeIngredient[]): Promise<string | null> {
  if (!_companyId) return 'Şirkət konteksti yoxdur';
  try {
    const seen = new Set<string>();
    const rows: { company_id: string; menu_item_id: string; stock_item_id: string; qty: number }[] = [];
    for (const l of lines) {
      if (!l.stockItemId || !(l.qty > 0) || seen.has(l.stockItemId)) continue;
      seen.add(l.stockItemId);
      rows.push({ company_id: _companyId, menu_item_id: menuItemId, stock_item_id: l.stockItemId, qty: l.qty });
    }
    if (rows.length > 0) {
      const { error } = await supabase.from('recipe_lines').upsert(rows, { onConflict: 'menu_item_id,stock_item_id' });
      if (error) { console.error('[saveRecipe upsert]', error); return error.message; }
    }
    let del = supabase.from('recipe_lines').delete().eq('menu_item_id', menuItemId).eq('company_id', _companyId);
    if (rows.length > 0) del = del.not('stock_item_id', 'in', `(${rows.map(r => `"${r.stock_item_id}"`).join(',')})`);
    const { error: delError } = await del;
    if (delError) { console.error('[saveRecipe prune]', delError); return delError.message; }
    return null;
  } catch (e) {
    console.error('[saveRecipe]', e);
    return 'Şəbəkə xətası — resept yadda saxlanmadı';
  }
}

// Back a menu product with its own stock item + qty-1 self recipe + a 0 balance
// in the sales warehouse, so it shows in Qalıqlar and deducts itself on sale.
// Idempotent: a menu item that already has a recipe is left untouched.
export async function linkProductStock(menuItemId: string, unit = 'ədəd'): Promise<string | null> {
  const { error } = await supabase.rpc('link_product_stock', { p_menu_item_id: menuItemId, p_unit: unit });
  if (error) {
    console.error('[linkProductStock]', error);
    if (error.message.includes('no_sales_warehouse')) return 'Əvvəlcə satış anbarı seçin (Anbar → Anbarlar)';
    if (error.message.includes('not_owner')) return 'Yalnız sahib məhsulu anbara əlavə edə bilər';
    return error.message;
  }
  return null;
}

export async function fetchSalesWarehouse(): Promise<string | null> {
  try {
    if (!_companyId) return null;
    const { data, error } = await supabase.from('companies').select('sales_warehouse_id').eq('id', _companyId).single();
    if (error || !data) return null;
    return data.sales_warehouse_id ?? null;
  } catch { return null; }
}

export async function setSalesWarehouse(id: string | null): Promise<string | null> {
  const { error } = await supabase.rpc('set_sales_warehouse', { p_id: id });
  if (error) { console.error('[setSalesWarehouse]', error); return error.message; }
  return null;
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

export async function fetchSellerToken(companyId: string): Promise<string | null> {
  try {
    const { data } = await supabase.from('companies').select('seller_token').eq('id', companyId).single();
    return data?.seller_token ?? null;
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

export async function fetchQrEnabled(): Promise<boolean> {
  try {
    if (!_companyId) return true;
    const { data, error } = await supabase.from('companies').select('qr_enabled').eq('id', _companyId).single();
    if (error || !data) return true;
    return data.qr_enabled !== false;
  } catch { return true; }
}

export async function setQrEnabled(enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_qr_enabled', { enabled });
  if (error) console.error('[setQrEnabled]', error);
}

export async function fetchMenuOnly(): Promise<boolean> {
  try {
    if (!_companyId) return false;
    const { data, error } = await supabase.from('companies').select('menu_only').eq('id', _companyId).single();
    if (error || !data) return false;
    return data.menu_only === true;
  } catch { return false; }
}

export async function setMenuOnly(enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_menu_only', { enabled });
  if (error) console.error('[setMenuOnly]', error);
}

export async function fetchPrintReceipt(): Promise<boolean> {
  try {
    if (!_companyId) return true;
    const { data, error } = await supabase.from('companies').select('print_receipt').eq('id', _companyId).single();
    if (error || !data) return true;
    return data.print_receipt !== false;
  } catch { return true; }
}

export async function setPrintReceiptEnabled(enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_print_receipt', { enabled });
  if (error) console.error('[setPrintReceiptEnabled]', error);
}

export async function fetchKassaEnabled(): Promise<boolean> {
  try {
    if (!_companyId) return true;
    const { data, error } = await supabase.from('companies').select('kassa_enabled').eq('id', _companyId).single();
    if (error || !data) return true;
    return data.kassa_enabled !== false;
  } catch { return true; }
}

export async function setKassaEnabled(enabled: boolean): Promise<{ error?: string }> {
  if (!enabled) {
    const { data } = await supabase.from('cash_shifts').select('id').eq('company_id', _companyId).is('closed_at', null).maybeSingle();
    if (data) return { error: 'Açıq növbə var — əvvəlcə növbəni bağlayın.' };
  }
  const { error } = await supabase.rpc('set_kassa_enabled', { enabled });
  if (error) console.error('[setKassaEnabled]', error);
  return {};
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
// net of change — i.e. exactly what went into the drawer.
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

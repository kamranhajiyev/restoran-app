import { CashShift, Category, Courier, CourierLedger, CourierPayMethod, CourierPayment, Hall, MenuItem, ModifierGroup, ModifierOption, Order, OrderItem, ReceiptLine, ReceiptLineDetail, RecipeIngredient, RecipeLineRow, RestaurantTable, ShiftEdit, ShiftMovement, Staff, Station, StockBalance, StockItem, StockMovement, StockReceipt, StockTransfer, Supplier, SupplierLedger, SupplierPayment, TrashItem, TransferLine, TransferLineDetail, Warehouse, WriteoffEntry } from '@/types';
import { CompanySettings, DEFAULT_SETTINGS, DEFAULT_TZ } from './business-day';
import { splitOrderItems } from './order-items';
import { supabase } from './supabase';
import { ADD_ORDER, localWrite, type LocalWrite } from './till-write';
import type { TillSettings } from './desktopPrint';

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

// ─── The desktop till's local copy ────────────────────────────────────────────
//
// Inside the Windows app these reads are answered by SQLite on the machine
// instead of by Supabase, so the till keeps working with the cable unplugged
// and a reload during an outage comes back with the room still on it.
//
// Done here rather than in app/seller/page.tsx because the till reaches its data
// two ways — a signed-in waiter goes through these functions, a terminal link
// goes through /api/public-* — and a fix in only one of them leaves whichever
// half the restaurant actually uses still talking to the network.
//
// `server: true` is how lib/till-sync.ts asks for the real thing: it is the code
// that FILLS the local copy, and would otherwise read back what it just wrote.
// An explicit argument rather than a module flag, because a flag set around an
// await would also divert whatever the page happened to request meanwhile.

export interface ReadOpts {
  /** Skip the local copy and ask Supabase. Only the sync has any business here. */
  server?: boolean;
  /**
   * Insert the order under the number it already carries instead of letting the
   * server's counter pick one.
   *
   * Only the desktop till's replay may ask for this, and only because that till
   * numbered the order on its own machine and printed the number on a receipt
   * hours ago. A browser's queued order carries an optimistic guess instead —
   * for that one the server's counter is still the authority.
   */
  keepOrderNumber?: boolean;
}

function localTill(opts?: ReadOpts) {
  if (opts?.server) return null;
  if (typeof window === 'undefined') return null;
  return window.posNative?.till ?? null;
}

/** The local copy's answer, or null when there is no local copy to ask. */
async function fromLocal<T>(
  opts: ReadOpts | undefined,
  read: (till: NonNullable<NonNullable<Window['posNative']>['till']>, companyId: string) => Promise<T>,
): Promise<T | null> {
  const till = localTill(opts);
  if (!till || !_companyId) return null;
  try {
    return await read(till, _companyId);
  } catch {
    // The database is on the same disk as the app; a failure here is not an
    // outage to ride out, it is a broken install. Fall through to the network
    // so the till still works while somebody looks at it.
    return null;
  }
}

// The same inversion for writes. A signed-in waiter on the desktop till reaches
// these functions directly, so without this the terminal-link half of the app
// would be offline-capable and the logged-in half would not — the harder failure
// to spot, because it only shows up on the machine the restaurant actually uses.
//
// Returns null when there is no local database, which sends the caller down the
// Supabase path it has always taken. See lib/till-write.ts for the vocabulary of
// `kind`, and electron/till-write.ts for what each one does to the row.
async function toLocal(
  opts: ReadOpts | undefined,
  id: string,
  kind: string,
  body: Record<string, unknown>,
): Promise<LocalWrite | null> {
  if (opts?.server) return null;
  return localWrite(id, kind, body, _companyId);
}

function isValidUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

// ─── Menu ─────────────────────────────────────────────────────────────────────

// Guards against the "failed fetch → empty screen → save wipes real data" chain:
// saves are refused until the corresponding fetch has succeeded at least once.
let _menuLoaded = false;
let _categoriesLoaded = false;

export async function fetchMenu(opts?: ReadOpts): Promise<MenuItem[]> {
  const local = await fromLocal(opts, async (till, companyId) =>
    ((await till.menu(companyId)) as { items: MenuItem[] }).items);
  if (local) return local;

  try {
    const { data, error } = await supabase.from('menu_items').select('*').order('position');
    if (error || !data) return [];
    _menuLoaded = true;

    // Which reusable modifier sets each item offers. A failed link read must not
    // look like "no item has any set" — that would make the next saveMenu prune
    // every link. On error we leave modifierGroupIds undefined, which saveMenu
    // reads as "don't touch this item's links".
    const { data: links, error: linkError } = await supabase
      .from('menu_item_modifier_groups')
      .select('menu_item_id, group_id')
      .order('position');
    const byItem = new Map<string, string[]>();
    if (!linkError && links) {
      for (const l of links) {
        const bucket = byItem.get(l.menu_item_id);
        if (bucket) bucket.push(l.group_id); else byItem.set(l.menu_item_id, [l.group_id]);
      }
    }

    return data.map(r => ({
      id: r.id,
      name: r.name,
      price: Number(r.price),
      category: r.category,
      available: r.available,
      qrVisible: r.qr_visible ?? true,
      variants: r.variants ?? undefined,
      costPrice: r.cost_price ? Number(r.cost_price) : undefined,
      image: r.image ?? undefined,
      stationId: r.station_id ?? null,
      kind: r.kind ?? 'product',
      modifierGroupIds: linkError ? undefined : (byItem.get(r.id) ?? []),
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
    // Only for items that actually carried a list — undefined means "the caller
    // doesn't know about this item's sets", and its links are left alone.
    const linkRows: { menu_item_id: string; group_id: string; position: number }[] = [];
    const relinkedItemIds: string[] = [];
    for (const m of menu) {
      const id = isValidUUID(m.id) ? m.id : crypto.randomUUID();
      if (seen.has(id)) continue;
      seen.add(id);
      if (m.modifierGroupIds) {
        relinkedItemIds.push(id);
        m.modifierGroupIds.forEach((gid, i) => linkRows.push({ menu_item_id: id, group_id: gid, position: i }));
      }
      rows.push({
        id,
        name: m.name,
        price: m.price,
        category: m.category,
        available: m.available,
        qr_visible: m.qrVisible ?? true,
        variants: m.variants ?? null,
        cost_price: m.costPrice ?? null,
        image: m.image ?? null,
        station_id: m.stationId ?? null,
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

    // Replace the modifier-set links of the items we were given a list for. Items
    // deleted above took their links with them (FK cascade), so nothing is orphaned.
    if (relinkedItemIds.length > 0) {
      const { error: unlinkError } = await supabase
        .from('menu_item_modifier_groups').delete().in('menu_item_id', relinkedItemIds);
      if (unlinkError) { console.error('[saveMenu unlink]', unlinkError); return unlinkError.message; }
      if (linkRows.length > 0) {
        const { error: linkError } = await supabase.from('menu_item_modifier_groups').insert(linkRows);
        if (linkError) { console.error('[saveMenu link]', linkError); return linkError.message; }
      }
    }
    return null;
  } catch (e) {
    console.error('[saveMenu]', e);
    return 'Şəbəkə xətası — menyu yadda saxlanmadı';
  }
}

export async function setMenuItemAvailable(id: string, available: boolean): Promise<void> {
  await supabase.from('menu_items').update({ available }).eq('id', id).eq('company_id', _companyId);
}

// ─── Modifikatorlar ───────────────────────────────────────────────────────────

// Same "failed fetch must not wipe data" guard as the menu: a save is refused
// until a fetch has succeeded at least once.
let _modifiersLoaded = false;

export async function fetchModifierGroups(opts?: ReadOpts): Promise<ModifierGroup[]> {
  const local = await fromLocal(opts, async (till, companyId) =>
    ((await till.modifiers(companyId)) as { groups: ModifierGroup[] }).groups);
  if (local) return local;

  try {
    const [{ data: groups, error: gError }, { data: options, error: oError }] = await Promise.all([
      supabase.from('modifier_groups').select('*').order('position'),
      supabase.from('modifier_options').select('*').order('position'),
    ]);
    if (gError || !groups || oError || !options) return [];
    _modifiersLoaded = true;

    const byGroup = new Map<string, ModifierOption[]>();
    for (const o of options) {
      const opt: ModifierOption = {
        id: o.id,
        name: o.name,
        price: Number(o.price),
        image: o.image ?? undefined,
        position: o.position,
      };
      const bucket = byGroup.get(o.group_id);
      if (bucket) bucket.push(opt); else byGroup.set(o.group_id, [opt]);
    }

    return groups.map(g => ({
      id: g.id,
      name: g.name,
      minSelect: g.min_select,
      maxSelect: g.max_select ?? null,
      position: g.position,
      options: byGroup.get(g.id) ?? [],
    }));
  } catch {
    return [];
  }
}

// Upsert-then-prune, mirroring saveMenu: a rejected write leaves the existing sets
// intact instead of emptying them. Returns an error message for the UI, or null.
export async function saveModifierGroups(groups: ModifierGroup[]): Promise<string | null> {
  if (!_companyId || !_modifiersLoaded) {
    console.error('[saveModifierGroups] refused: no company context or sets never loaded');
    return 'Modifikatorlar hələ yüklənməyib';
  }
  try {
    const groupRows = groups.map((g, i) => ({
      id: isValidUUID(g.id) ? g.id : crypto.randomUUID(),
      company_id: _companyId,
      name: g.name,
      min_select: g.minSelect,
      max_select: g.maxSelect,
      position: i,
    }));

    if (groupRows.length > 0) {
      const { error } = await supabase.from('modifier_groups').upsert(groupRows, { onConflict: 'id' });
      if (error) { console.error('[saveModifierGroups upsert]', error); return error.message; }
    }
    let delGroups = supabase.from('modifier_groups').delete().eq('company_id', _companyId);
    if (groupRows.length > 0) delGroups = delGroups.not('id', 'in', `(${groupRows.map(r => `"${r.id}"`).join(',')})`);
    const { error: delError } = await delGroups;
    if (delError) { console.error('[saveModifierGroups prune]', delError); return delError.message; }

    // Options are written against the ids the groups just got, so a brand-new set
    // and its options land in the same save.
    const optionRows = groups.flatMap((g, gi) =>
      g.options.map((o, i) => ({
        id: isValidUUID(o.id) ? o.id : crypto.randomUUID(),
        group_id: groupRows[gi].id,
        name: o.name,
        price: o.price,
        image: o.image ?? null,
        position: i,
      })));

    if (optionRows.length > 0) {
      const { error } = await supabase.from('modifier_options').upsert(optionRows, { onConflict: 'id' });
      if (error) { console.error('[saveModifierGroups options]', error); return error.message; }
    }
    // Prune only within the surviving groups — a deleted group already took its
    // options with it via the FK cascade.
    if (groupRows.length > 0) {
      let delOptions = supabase.from('modifier_options')
        .delete().in('group_id', groupRows.map(r => r.id));
      if (optionRows.length > 0) delOptions = delOptions.not('id', 'in', `(${optionRows.map(r => `"${r.id}"`).join(',')})`);
      const { error } = await delOptions;
      if (error) { console.error('[saveModifierGroups options prune]', error); return error.message; }
    }
    return null;
  } catch (e) {
    console.error('[saveModifierGroups]', e);
    return 'Şəbəkə xətası — modifikatorlar yadda saxlanmadı';
  }
}

// ─── Categories ───────────────────────────────────────────────────────────────

// No placeholder fallback: a company with no categories sees an empty list and
// creates its own. The old default list ("Çay", "Snack", …) looked like real
// data and got persisted by the next save, polluting the company's categories.
export async function fetchCategories(opts?: ReadOpts): Promise<Category[]> {
  const local = await fromLocal(opts, async (till, companyId) =>
    ((await till.categories(companyId)) as { categories: Category[] }).categories);
  if (local) return local;

  try {
    const { data, error } = await supabase.from('categories').select('name, available, qr_visible').order('position');
    if (error || !data) return [];
    _categoriesLoaded = true;
    return data.map((r: { name: string; available: boolean; qr_visible: boolean | null }) =>
      ({ name: r.name, available: r.available, qrVisible: r.qr_visible ?? true }));
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
    const rows: { name: string; available: boolean; qr_visible: boolean; position: number; company_id: string }[] = [];
    for (const c of categories) {
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      rows.push({ name: c.name, available: c.available, qr_visible: c.qrVisible ?? true, position: rows.length, company_id: _companyId });
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

// ─── Stations (sexlər) ────────────────────────────────────────────────────────

let _stationsLoaded = false;

export async function fetchStations(opts?: ReadOpts): Promise<Station[]> {
  const local = await fromLocal(opts, async (till, companyId) =>
    ((await till.stations(companyId)) as { stations: Station[] }).stations);
  if (local) return local;

  try {
    // position, then created_at — the same order the print_jobs triggers use to pick
    // the fallback "first station". position defaults to 0, so without the tiebreak
    // two stations could rank differently here than they do in the DB, and the prep
    // screen would show food the ticket sent somewhere else.
    const { data, error } = await supabase
      .from('stations')
      .select('id, name, printer_ip, printer_port')
      .order('position')
      .order('created_at');
    if (error || !data) return [];
    _stationsLoaded = true;
    return data.map(r => ({
      id: r.id,
      name: r.name,
      printerIp: r.printer_ip ?? null,
      printerPort: r.printer_port ?? 9100,
    }));
  } catch {
    return [];
  }
}

// Same upsert-then-prune contract as saveMenu: a failed write leaves the
// existing rows alone. Pruning a station nulls its items' station_id (FK is
// ON DELETE SET NULL) — the items themselves are never touched.
export async function saveStations(stations: Station[]): Promise<string | null> {
  if (!_companyId || !_stationsLoaded) { console.error('[saveStations] refused: no company context or stations never loaded'); return 'Sexlər hələ yüklənməyib'; }
  try {
    const seen = new Set<string>();
    const rows: Record<string, unknown>[] = [];
    for (const s of stations) {
      const name = s.name.trim();
      if (!name || seen.has(name)) continue;   // the (company_id, name) unique index would reject the whole write
      seen.add(name);
      rows.push({
        id: isValidUUID(s.id) ? s.id : crypto.randomUUID(),
        name,
        printer_ip: s.printerIp?.trim() || null,
        printer_port: s.printerPort ?? 9100,
        position: rows.length,
        company_id: _companyId,
      });
    }
    if (rows.length > 0) {
      const { error } = await supabase.from('stations').upsert(rows, { onConflict: 'id' });
      if (error) { console.error('[saveStations upsert]', error); return error.message; }
    }
    let del = supabase.from('stations').delete().eq('company_id', _companyId);
    if (rows.length > 0) del = del.not('id', 'in', `(${rows.map(r => `"${r.id}"`).join(',')})`);
    const { error: delError } = await del;
    if (delError) { console.error('[saveStations prune]', delError); return delError.message; }
    return null;
  } catch (e) {
    console.error('[saveStations]', e);
    return 'Şəbəkə xətası — sexlər yadda saxlanmadı';
  }
}

// Bulk-assign items to a station straight from the Sexlər view, without
// round-tripping the whole menu through saveMenu.
export async function assignItemsToStation(itemIds: string[], stationId: string | null): Promise<string | null> {
  if (!_companyId) return 'Şirkət tapılmadı';
  if (itemIds.length === 0) return null;
  const { error } = await supabase
    .from('menu_items')
    .update({ station_id: stationId })
    .in('id', itemIds)
    .eq('company_id', _companyId);
  if (error) { console.error('[assignItemsToStation]', error); return error.message; }
  return null;
}

// ─── Print jobs (sex printerləri) ─────────────────────────────────────────────

// Orders whose kitchen/bar ticket never came out. A ticket that vanishes in
// silence is worse than having no printer at all, so the seller screen shows it.
export async function fetchFailedPrintOrders(): Promise<string[]> {
  try {
    if (!_companyId) return [];
    const { data, error } = await supabase
      .from('print_jobs')
      .select('order_id')
      .eq('company_id', _companyId)
      .eq('status', 'failed');
    if (error || !data) return [];
    return [...new Set(data.map(r => r.order_id as string))];
  } catch {
    return [];
  }
}

// Re-queue an order's failed tickets — paper jam, printer was off, someone
// binned the slip. The payload is untouched, so it reprints what was ordered
// *then*, not what the order looks like now.
export async function retryPrintJobs(orderId: string): Promise<string | null> {
  if (!_companyId) return 'Şirkət tapılmadı';
  const { error } = await supabase
    .from('print_jobs')
    .update({ status: 'pending', attempts: 0, error: null })
    .eq('order_id', orderId)
    .eq('company_id', _companyId)
    .eq('status', 'failed');
  if (error) { console.error('[retryPrintJobs]', error); return error.message; }
  return null;
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

export async function fetchOrders(opts?: { from?: string; to?: string; limit?: number; offset?: number } & ReadOpts): Promise<Order[]> {
  const local = await fromLocal(opts, async (till, companyId) =>
    ((await till.orders(companyId, {
      from: opts?.from, to: opts?.to, limit: opts?.limit, offset: opts?.offset,
    })) as { orders: Order[] }).orders);
  if (local) return local;

  try {
    const PAGE = 1000;
    const offset = opts?.offset ?? 0;
    const all: Awaited<ReturnType<typeof runPage>> = [];
    async function runPage(start: number, end: number) {
      // Order the nested rows too: nothing sorted them before, so the item list
      // relied on incidental insert order — and the batch dividers need them in
      // the sequence they were actually added.
      let q = supabase.from('orders').select('*, order_items(*)')
        .order('created_at', { ascending: false })
        .order('created_at', { referencedTable: 'order_items', ascending: true })
        .range(start, end);
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
      tillNumber: o.till_number ?? undefined,
      tableNumber: o.table_id ?? 0,
      sellerName: o.waiter_name,
      staffId: o.staff_id ?? undefined,
      courierId: o.courier_id ?? undefined,
      courierDebt: o.courier_debt ? Number(o.courier_debt) : undefined,
      status: o.status as Order['status'],
      note: o.note ?? undefined,
      createdAt: o.created_at,
      cashAmount: o.cash_amount ? Number(o.cash_amount) : undefined,
      cardAmount: o.card_amount ? Number(o.card_amount) : undefined,
      changeAmount: o.change_amount ? Number(o.change_amount) : undefined,
      discountAmount: o.discount_amount ? Number(o.discount_amount) : undefined,
      discountType: (o.discount_type as '%' | '₼') ?? undefined,
      paidAt: o.paid_at ?? undefined,
      cancelledAt: o.cancelled_at ?? undefined,
      cancelledBy: o.cancelled_by ?? undefined,
      cancelReason: o.cancel_reason ?? undefined,
      ...splitOrderItems(o.order_items),
    }));
  } catch {
    return [];
  }
}

// ─── Per-sex readiness ────────────────────────────────────────────────────────
// orders.status ('hazırdır') describes the whole order, but an order spans several
// sexes. These rows are the only place that can say "the bar is done and the
// kitchen isn't".

export type StationReady = { orderId: string; stationId: string; readyAt: string; readyBy: string | null };

export async function fetchStationReady(orderIds?: string[], opts?: ReadOpts): Promise<StationReady[]> {
  const local = await fromLocal(opts, async (till, companyId) => {
    const { ready } = (await till.stationReady(companyId)) as { ready: StationReady[] };
    return orderIds ? ready.filter(r => orderIds.includes(r.orderId)) : ready;
  });
  if (local) return local;

  try {
    let q = supabase.from('order_station_ready').select('order_id, station_id, ready_at, ready_by');
    if (orderIds) {
      if (orderIds.length === 0) return [];
      q = q.in('order_id', orderIds);
    }
    const { data, error } = await q;
    if (error || !data) return [];
    return data.map(r => ({
      orderId: r.order_id,
      stationId: r.station_id,
      readyAt: r.ready_at,
      readyBy: r.ready_by ?? null,
    }));
  } catch {
    return [];
  }
}

// Upsert, not insert: two cooks at the same sex tapping "Hazırdır" on the same order
// is a race the primary key would otherwise turn into an error on the second tap.
//
// The conflict UPDATES ready_at rather than ignoring it. A sex re-clears after the
// waiter adds work (readyStationIds compares ready_at against the new line's
// created_at), so tapping "Hazırdır" again MUST push ready_at past that line — an
// ignored write would leave it stuck at the first tap and the card would never
// clear. Two near-simultaneous taps resolve fine: last write wins, sub-second apart.
export async function markStationReady(orderId: string, stationId: string, readyBy: string): Promise<string | null> {
  if (!_companyId) return 'Şirkət tapılmadı';
  try {
    const { error } = await supabase
      .from('order_station_ready')
      .upsert(
        { order_id: orderId, station_id: stationId, company_id: _companyId, ready_by: readyBy, ready_at: new Date().toISOString() },
        { onConflict: 'order_id,station_id' },
      );
    if (error) { console.error('[markStationReady]', error); return error.message; }
    return null;
  } catch (e) {
    console.error('[markStationReady]', e);
    return 'Şəbəkə xətası — hazır qeyd edilmədi';
  }
}

// Undo, for the tap that was meant for the card underneath.
export async function unmarkStationReady(orderId: string, stationId: string): Promise<string | null> {
  try {
    const { error } = await supabase
      .from('order_station_ready')
      .delete()
      .eq('order_id', orderId)
      .eq('station_id', stationId);
    if (error) { console.error('[unmarkStationReady]', error); return error.message; }
    return null;
  } catch {
    return 'Şəbəkə xətası';
  }
}

export async function addOrder(order: Order, opts?: ReadOpts): Promise<string | null> {
  // `server: true` is how the replay in lib/sync.ts asks for the real insert —
  // without it a queued order would be "sent" straight back into the machine it
  // came from and never reach Supabase at all.
  const local = await toLocal(opts, `order:${order.id}`, ADD_ORDER, order as unknown as Record<string, unknown>);
  if (local) return local.ok ? null : local.error ?? 'failed';

  try {
    const { error: orderError } = await supabase.from('orders').insert({
      id: order.id,
      // Absent on every other path, where the assign_order_number trigger fills
      // it in. Supplied, the trigger keeps it and moves the counter past it.
      ...(opts?.keepOrderNumber && order.orderNumber ? { order_number: order.orderNumber } : {}),
      // Travels with the number it qualifies, and only then: an order the server
      // numbered belongs to no till and must stay null, or the report would
      // start labelling web-till orders as coming from a counter.
      ...(opts?.keepOrderNumber && order.tillNumber ? { till_number: order.tillNumber } : {}),
      table_id: order.tableNumber === 0 ? null : order.tableNumber,
      waiter_name: order.sellerName,
      staff_id: order.staffId ?? null,
      courier_id: order.courierId ?? null,
      status: order.status,
      note: order.note ?? null,
      created_at: order.createdAt,
      company_id: _companyId,
    });
    if (orderError) { console.error('[addOrder orders]', orderError); return orderError.message; }
    if (order.items.length === 0) return null;
    const rows = order.items.map(oi => ({
      // An order taken on the desktop till named its own lines before Supabase
      // ever heard of them, and the till has been referring to them by those
      // names since — "remove one Cola" carries the id it minted. Letting the
      // server generate its own here would orphan every one of those edits.
      ...(oi.id ? { id: oi.id } : {}),
      order_id: order.id,
      menu_item_id: String(oi.menuItem.id),
      menu_item_name: String(oi.menuItem.name),
      // Already includes every selected modifier's price — this snapshot is what
      // every total in the app reads.
      menu_item_price: Number(oi.menuItem.price),
      quantity: Number(oi.quantity),
      modifiers: oi.modifiers ?? null,
      modifiers_detail: oi.modifiersDetail ?? null,
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
  // A fresh key per append: the same dish added twice to one order is two
  // legitimate writes, not a retry of one.
  const local = await toLocal(undefined, `append:${crypto.randomUUID()}`, '/api/add-order-items', {
    orderId, items, note: note ?? undefined,
  });
  if (local) return local.ok ? null : local.error ?? 'failed';

  try {
    // Refuse to append to an order that's already closed (paid/cancelled/deleted) —
    // matches the public API route and the conditional pay/cancel flows.
    const { data: ord, error: ordError } = await supabase
      .from('orders').select('status').eq('id', orderId).eq('company_id', _companyId).single();
    if (ordError || !ord) { console.error('[addItemsToOrder order]', ordError); return ordError?.message ?? 'closed'; }
    if (['ödənilib', 'ləğv edildi', 'silinib'].includes(ord.status)) return 'closed';

    if (items.length > 0) {
      const rows = items.map(oi => ({
        ...(oi.id ? { id: oi.id } : {}),   // see addOrder: the till names its own lines
        order_id: orderId,
        menu_item_id: String(oi.menuItem.id),
        menu_item_name: String(oi.menuItem.name),
        menu_item_price: Number(oi.menuItem.price),
        quantity: Number(oi.quantity),
        modifiers: oi.modifiers ?? null,
        modifiers_detail: oi.modifiersDetail ?? null,
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
  // Set only when a courier order closes on the "kuryer yığacaq" path: nothing
  // is tendered, and this is what the rider owes for it.
  courierDebt?: number,
): Promise<boolean> {
  // One key per order for a payment, one per target status otherwise: a payment
  // must be applied exactly once however many times it is retried, while
  // "gözləyir → hazırlanır → hazırdır" is three distinct steps.
  const local = await toLocal(
    undefined,
    status === 'ödənilib' ? `pay:${orderId}` : `status:${orderId}:${status}`,
    '/api/update-order-status',
    { orderId, status, cashAmount, cardAmount, changeAmount, discountAmount, discountType, courierDebt },
  );
  if (local) return local.ok;

  const updates: Record<string, unknown> = { status };
  // Plain status changes must not touch payment data
  const hasAmounts = cashAmount !== undefined || cardAmount !== undefined || changeAmount !== undefined;
  if (hasAmounts) {
    updates.cash_amount = cashAmount ?? 0;
    updates.card_amount = cardAmount ?? 0;
    updates.change_amount = changeAmount ?? 0;
    updates.discount_amount = discountAmount ?? 0;
    updates.discount_type = discountType ?? '₼';
    // Written on the same statement as the amounts it replaces, so an order can
    // never be both paid in cash and owed by a courier.
    updates.courier_debt = courierDebt ?? 0;
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

// A party moves, or the order was rung up on the wrong table. Only the table
// changes — the order number, the items and the kitchen's place in the queue all
// stay put. A closed order can't move: its table is history at that point.
// The stations that already hold a ticket get a notice slip from the
// orders_enqueue_table_move trigger.
export async function moveOrderTable(orderId: string, tableId: number): Promise<boolean> {
  // The target is in the key: moving a party twice during an outage is two
  // separate writes, and both must land in the order they were made.
  const local = await toLocal(undefined, `move:${orderId}:${tableId}`, '/api/move-table', { orderId, tableId });
  if (local) return local.ok;

  const { data, error } = await supabase.from('orders')
    .update({ table_id: tableId })
    .eq('id', orderId)
    .eq('company_id', _companyId)
    .neq('status', 'ödənilib')
    .neq('status', 'ləğv edildi')
    .neq('status', 'silinib')
    .select('id');
  if (error) { console.error('[moveOrderTable]', error.message); return false; }
  return (data?.length ?? 0) > 0;
}

// A different rider takes the order. Which one it will be is rarely known when
// the order is rung up, so the courier picked at the till is a first guess.
//
// Open orders only: after payment the total is already on a courier's balance as
// debt, and moving it is a transfer between two books rather than this write.
export async function changeOrderCourier(orderId: string, courierId: string): Promise<boolean> {
  // The courier is in the key: reassigning twice during an outage is two separate
  // writes, and both must land in the order they were made.
  const local = await toLocal(undefined, `courier:${orderId}:${courierId}`, '/api/change-courier', { orderId, courierId });
  if (local) return local.ok;

  const { data, error } = await supabase.from('orders')
    .update({ courier_id: courierId })
    .eq('id', orderId)
    .eq('company_id', _companyId)
    .not('courier_id', 'is', null)
    .neq('status', 'ödənilib')
    .neq('status', 'ləğv edildi')
    .neq('status', 'silinib')
    .select('id');
  if (error) { console.error('[changeOrderCourier]', error.message); return false; }
  return (data?.length ?? 0) > 0;
}

// Only unpaid orders can be cancelled — a paid order is final, mistakes after
// payment are for the owner to sort out manually.
export async function cancelOrder(orderId: string, reason: string, by: string): Promise<boolean> {
  const local = await toLocal(undefined, `cancel:${orderId}`, '/api/cancel-order', { orderId, reason, by });
  if (local) return local.ok;

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

// Remove a whole line from an open order (authed seller). A soft delete, not a
// delete: the row stays so the order card can show it struck through, and so the
// kitchen's LEGV slip has something to print. Every total filters it out via
// splitOrderItems, and apply_stock_on_payment() skips it, so the guest is never
// charged and the warehouse never drains for a dish that wasn't made.
export async function removeOrderItem(orderItemId: string, removedBy: string, orderId?: string): Promise<boolean> {
  // orderId is optional only because Supabase does not need it — the row id is
  // enough there. The till's copy stores an order whole, so locally it is the
  // only way to find the line at all; a caller that omits it on the desktop gets
  // the network path, which is the honest failure rather than a silent no-op.
  const local = orderId
    ? await toLocal(undefined, `remove:${orderItemId}`, '/api/remove-order-item', { orderItemId, orderId, removedBy })
    : null;
  if (local) return local.ok;

  const { error } = await supabase.from('order_items')
    .update({ removed_at: new Date().toISOString(), removed_by: removedBy })
    .eq('id', orderItemId)
    .is('removed_at', null);            // never re-stamp an already-removed line
  if (error) { console.error('[removeOrderItem]', error.message); return false; }
  return true;
}

// Change a line's quantity on an open order (authed seller).
//
// A partial decrement (Cola 2 → 1) records what was *taken away*: the line drops to
// its new quantity and a ghost row carrying the difference is inserted, already
// removed. That ghost is what the card strikes through and what the kitchen's
// "cancel 1 Cola" slip is built from.
export async function setOrderItemQuantity(orderItemId: string, quantity: number, removedBy: string, orderId?: string): Promise<boolean> {
  if (quantity <= 0) return removeOrderItem(orderItemId, removedBy, orderId);

  // Keyed by the quantity it lands on, so two taps of "−" are two distinct
  // steps while a retry of either stays one.
  const local = orderId
    ? await toLocal(undefined, `qty:${orderItemId}:${quantity}`, '/api/update-order-item-qty', {
        orderItemId, orderId, quantity, removedBy,
      })
    : null;
  if (local) return local.ok;

  const { data: row, error: readError } = await supabase
    .from('order_items')
    .select('order_id, menu_item_id, menu_item_name, menu_item_price, modifiers, modifiers_detail, variant_id, quantity')
    .eq('id', orderItemId)
    .single();
  if (readError || !row) { console.error('[setOrderItemQuantity read]', readError?.message); return false; }

  const removedQty = row.quantity - quantity;
  if (removedQty <= 0) {   // an increase, or no change — nothing was taken away
    const { error } = await supabase.from('order_items').update({ quantity }).eq('id', orderItemId);
    if (error) { console.error('[setOrderItemQuantity]', error.message); return false; }
    return true;
  }

  const { error } = await supabase.from('order_items').update({ quantity }).eq('id', orderItemId);
  if (error) { console.error('[setOrderItemQuantity]', error.message); return false; }

  const { error: ghostError } = await supabase.from('order_items').insert({
    order_id: row.order_id,
    menu_item_id: row.menu_item_id,
    menu_item_name: row.menu_item_name,
    menu_item_price: row.menu_item_price,
    modifiers: row.modifiers,
    modifiers_detail: row.modifiers_detail,
    variant_id: row.variant_id,
    quantity: removedQty,
    removed_at: new Date().toISOString(),
    removed_by: removedBy,
  });
  // The quantity already dropped, so the guest is charged correctly either way —
  // only the audit trail and the kitchen's cancel slip are lost. Don't fail the
  // whole action over it.
  if (ghostError) console.error('[setOrderItemQuantity ghost]', ghostError.message);
  return true;
}

export async function editOrderPayment(orderId: string, cashAmount: number, cardAmount: number): Promise<boolean> {
  // A courier delivery closes with nothing tendered and the whole total sitting
  // as that courier's debt. Writing cash/card onto it here would book the same
  // money twice: once in the day's takings, once again when the courier hands it
  // over. The way to correct such an order is "Qaytarıldı", not this edit.
  const { data: row } = await supabase.from('orders')
    .select('courier_debt').eq('id', orderId).maybeSingle();
  if ((row?.courier_debt ?? 0) > 0) {
    console.error('[editOrderPayment] refused: order has courier debt');
    return false;
  }

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

export async function fetchStaff(opts?: ReadOpts): Promise<Staff[]> {
  const local = await fromLocal(opts, async (till, companyId) =>
    ((await till.staff(companyId)) as { staff: Staff[] }).staff);
  if (local) return local;

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

// A stable per-terminal id so PIN lockout is scoped to this device, not the
// whole company. Persists in localStorage; a cleared browser gets a fresh one.
export function getDeviceId(): string {
  if (typeof window === 'undefined') return '';
  try {
    let id = localStorage.getItem('deviceId');
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('deviceId', id); }
    return id;
  } catch { return ''; }
}

export async function verifyStaffPin(pin: string, deviceId: string): Promise<PinResult> {
  try {
    const { data, error } = await supabase.rpc('verify_staff_pin', { p_pin: pin, p_device_id: deviceId });
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

// Goes through an RPC because a bare DELETE let six foreign keys decide the answer, and
// stock_balances keeps a qty = 0 row per item forever — so an emptied warehouse was
// undeletable. The RPC clears those cached rows and refuses only for real history.
// Returns a code ('sales_warehouse', 'has_history:57', 'has_stock', …) for the caller
// to phrase; see supabase/migrations/20260731_delete_warehouse.sql.
export async function deleteWarehouse(id: string): Promise<string | null> {
  const { error } = await supabase.rpc('delete_warehouse', { p_id: id });
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

// ─── Anbarlar arası transfer ────────────────────────────────────────────────────

export async function fetchTransfers(): Promise<StockTransfer[]> {
  try {
    const { data, error } = await supabase.from('stock_transfers')
      .select('id, from_warehouse_id, to_warehouse_id, note, created_by, created_at, voided_at, voided_by')
      .order('created_at', { ascending: false }).limit(200);
    if (error || !data) return [];
    return data.map(t => ({
      id: t.id, fromWarehouseId: t.from_warehouse_id, toWarehouseId: t.to_warehouse_id,
      note: t.note ?? undefined, createdBy: t.created_by ?? undefined, createdAt: t.created_at,
      voidedAt: t.voided_at ?? undefined, voidedBy: t.voided_by ?? undefined,
    }));
  } catch { return []; }
}

// The lines of one transfer, read off the outgoing leg (the incoming leg mirrors it).
export async function fetchTransferLines(transferId: string): Promise<TransferLineDetail[]> {
  try {
    const { data, error } = await supabase.from('stock_movements')
      .select('stock_item_id, qty, stock_items(name, unit)')
      .eq('transfer_id', transferId).eq('reason', 'transfer_out');
    if (error || !data) return [];
    return data.map((m: Record<string, unknown>) => {
      const si = (m.stock_items ?? {}) as { name?: string; unit?: string };
      return {
        stockItemId: m.stock_item_id as string,
        name: si.name ?? '',
        unit: si.unit ?? '',
        qty: Math.abs(Number(m.qty ?? 0)),
      };
    });
  } catch { return []; }
}

// Translate the RPC's raise codes into messages the user can act on.
function transferError(msg: string): string {
  const insufficient = msg.match(/insufficient_stock:(.*)/);
  if (insufficient) return `«${insufficient[1].trim()}» — mənbə anbarda bu qədər qalıq yoxdur.`;
  if (msg.includes('same_warehouse')) return 'Mənbə və hədəf anbar eyni ola bilməz.';
  return msg;
}

export async function recordTransfer(fromId: string, toId: string, lines: TransferLine[], note: string): Promise<string | null> {
  const { error } = await supabase.rpc('record_transfer', {
    p_from: fromId,
    p_to: toId,
    p_lines: lines.map(l => ({ stock_item_id: l.stockItemId, qty: l.qty })),
    p_note: note || null,
  });
  if (error) { console.error('[recordTransfer]', error); return transferError(error.message); }
  return null;
}

// Soft-delete a transfer: reverses both legs, keeps the row (shown red). Idempotent.
export async function voidTransfer(transferId: string): Promise<string | null> {
  const { error } = await supabase.rpc('void_transfer', { p_transfer_id: transferId });
  if (error) { console.error('[voidTransfer]', error); return transferError(error.message); }
  return null;
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

// Full dated log of standalone supplier payments (Ödənişlər view). Newest first.
export async function fetchSupplierPaymentLog(): Promise<SupplierPayment[]> {
  try {
    const { data, error } = await supabase.from('supplier_payments')
      .select('id, supplier_id, amount, note, created_by, created_at, suppliers(name)')
      .order('created_at', { ascending: false }).limit(300);
    if (error || !data) return [];
    return data.map((p: Record<string, unknown>) => {
      const s = (p.suppliers ?? {}) as { name?: string };
      return {
        id: p.id as string,
        supplierId: (p.supplier_id as string) ?? '',
        supplierName: s.name ?? '—',
        amount: Number(p.amount ?? 0),
        note: (p.note as string) ?? null,
        createdBy: (p.created_by as string) ?? null,
        createdAt: p.created_at as string,
      };
    });
  } catch { return []; }
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

// ─── Kuryerlər ────────────────────────────────────────────────────────────────
//
// A courier's balance is derived, never stored: what they owe on closed orders
// minus what they have handed over. Every query below therefore carries
// status = 'ödənilib' — see supabase/migrations/20260905_couriers.sql for why
// that predicate is load-bearing, and what breaks if one of them loses it.

/** Orders that count toward a courier's debt. The one definition, so a new
 *  caller cannot quietly disagree with the existing ones. */
const COURIER_DEBT_STATUS = 'ödənilib';

export async function fetchCouriers(opts?: ReadOpts): Promise<Courier[]> {
  const local = await fromLocal(opts, async (till, companyId) =>
    ((await till.couriers(companyId)) as { couriers: Courier[] }).couriers);
  if (local) return local;

  try {
    const { data, error } = await supabase.from('couriers')
      .select('id, name, phone, active, staff_id, created_at').order('created_at');
    if (error || !data) return [];
    return data.map(c => ({
      id: c.id, name: c.name, phone: c.phone ?? undefined, active: c.active,
      staffId: c.staff_id ?? undefined, createdAt: c.created_at,
    }));
  } catch { return []; }
}

export async function createCourier(name: string, phone: string): Promise<string | null> {
  const { error } = await supabase.from('couriers')
    .insert({ name, phone: phone || null, company_id: _companyId });
  if (error) { console.error('[createCourier]', error); return error.message; }
  return null;
}

export async function updateCourier(id: string, name: string, phone: string, active: boolean): Promise<string | null> {
  const { error } = await supabase.from('couriers')
    .update({ name, phone: phone || null, active }).eq('id', id);
  if (error) { console.error('[updateCourier]', error); return error.message; }
  return null;
}

// Refused by the database once the courier has carried anything — orders.courier_id
// is `on delete restrict` on purpose. The panel turns that into "deactivate instead".
export async function deleteCourier(id: string): Promise<string | null> {
  const { error } = await supabase.from('couriers').delete().eq('id', id);
  if (error) { console.error('[deleteCourier]', error); return error.message; }
  return null;
}

// Per-courier money summary. `from`/`to` scope `delivered`, `paid` and `orders`
// — `to` is exclusive, so callers pass the start of the day after the last one
// they want. `outstanding` is always the all-time balance, because that is what
// a seller standing in front of the courier needs to know regardless of the
// range on screen.
export async function fetchCourierLedger(range?: { from: string; to: string }): Promise<Record<string, CourierLedger>> {
  const out: Record<string, CourierLedger> = {};
  const ensure = (id: string) => (out[id] ??= { delivered: 0, paid: 0, outstanding: 0, orders: 0 });
  try {
    let ordersQ = supabase.from('orders')
      .select('courier_id, courier_debt, paid_at')
      .not('courier_id', 'is', null)
      .eq('status', COURIER_DEBT_STATUS);
    let paymentsQ = supabase.from('courier_payments').select('courier_id, amount, created_at');
    if (range) {
      ordersQ = ordersQ.gte('paid_at', range.from).lt('paid_at', range.to);
      paymentsQ = paymentsQ.gte('created_at', range.from).lt('created_at', range.to);
    }
    const [orders, payments, allTime] = await Promise.all([
      ordersQ,
      paymentsQ,
      range ? fetchCourierOutstanding() : Promise.resolve(null),
    ]);

    for (const o of orders.data ?? []) {
      if (!o.courier_id) continue;
      const l = ensure(o.courier_id);
      l.orders += 1;
      l.delivered += Number(o.courier_debt ?? 0);
    }
    for (const p of payments.data ?? []) {
      if (!p.courier_id) continue;
      ensure(p.courier_id).paid += Number(p.amount ?? 0);
    }

    if (allTime) {
      // Couriers with a standing balance but no activity in the range still
      // belong in the report — that is exactly who the owner is looking for.
      for (const id of Object.keys(allTime)) ensure(id);
      for (const id of Object.keys(out)) out[id].outstanding = allTime[id] ?? 0;
    } else {
      // No range: the two sums above already span everything.
      for (const id of Object.keys(out)) out[id].outstanding = out[id].delivered - out[id].paid;
    }
    return out;
  } catch { return out; }
}

// All-time balance per courier — what the seller screen shows. Negative means
// the restaurant owes the courier (they paid, then the order came back).
export async function fetchCourierOutstanding(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  try {
    const [orders, payments] = await Promise.all([
      supabase.from('orders').select('courier_id, courier_debt')
        .not('courier_id', 'is', null).eq('status', COURIER_DEBT_STATUS),
      supabase.from('courier_payments').select('courier_id, amount'),
    ]);
    for (const o of orders.data ?? []) {
      if (!o.courier_id) continue;
      out[o.courier_id] = (out[o.courier_id] ?? 0) + Number(o.courier_debt ?? 0);
    }
    for (const p of payments.data ?? []) {
      if (!p.courier_id) continue;
      out[p.courier_id] = (out[p.courier_id] ?? 0) - Number(p.amount ?? 0);
    }
  } catch { /* ignore */ }
  return out;
}

// Couriers with their balance already attached — the shape the seller screen
// works in, and what /api/public-couriers returns on the terminal path. Kept as
// one function so an authed till and a token till cannot drift apart.
export async function fetchCouriersWithBalance(opts?: ReadOpts): Promise<Courier[]> {
  const local = await fromLocal(opts, async (till, companyId) =>
    ((await till.couriers(companyId)) as { couriers: Courier[] }).couriers);
  if (local) return local;

  const [list, balance] = await Promise.all([fetchCouriers(opts), fetchCourierOutstanding()]);
  return list.map(c => ({ ...c, outstanding: balance[c.id] ?? 0 }));
}

// Full dated log of courier handovers (Ödənişlər view). Newest first.
export async function fetchCourierPaymentLog(): Promise<CourierPayment[]> {
  try {
    const { data, error } = await supabase.from('courier_payments')
      .select('id, courier_id, amount, method, note, created_by, shift_id, created_at, couriers(name)')
      .order('created_at', { ascending: false }).limit(300);
    if (error || !data) return [];
    return data.map((p: Record<string, unknown>) => {
      const c = (p.couriers ?? {}) as { name?: string };
      return {
        id: p.id as string,
        courierId: (p.courier_id as string) ?? '',
        courierName: c.name ?? '—',
        amount: Number(p.amount ?? 0),
        method: p.method === 'kart' ? 'kart' : 'nağd',
        note: (p.note as string) ?? null,
        createdBy: (p.created_by as string) ?? null,
        shiftId: (p.shift_id as string) ?? null,
        createdAt: p.created_at as string,
      };
    });
  } catch { return []; }
}

// What couriers handed over inside a window, split the way the money actually
// arrived. `to` is exclusive.
//
// This is the number the history screen adds to its Nağd/Kart tiles. A courier
// order closes with cash=0 and card=0 — the whole total sits as debt — so
// without this the day's takings read short by everything still out on a bike,
// which is precisely what a restaurant not running kassa shifts needs to see.
//
// Attributed by when the money arrived, not when the order was placed: a rider
// settling on Tuesday for Sunday's delivery puts that cash in Tuesday's drawer.
// Server first, unlike every other till read here, and the local database only
// when that fails. The till's courier_payments table holds the settlements THIS
// machine took and no others — enough to keep a seller honest through an outage,
// but it would quietly hide a second till's collections if it were preferred
// while the line is up.
export async function fetchCourierCollections(
  from: string,
  to: string,
  opts?: ReadOpts,
): Promise<{ nagd: number; kart: number }> {
  try {
    const { data, error } = await supabase.from('courier_payments')
      .select('amount, method').gte('created_at', from).lt('created_at', to);
    if (error) throw error;
    return (data ?? []).reduce((acc, p) => {
      if (p.method === 'kart') acc.kart += Number(p.amount ?? 0);
      else acc.nagd += Number(p.amount ?? 0);
      return acc;
    }, { nagd: 0, kart: 0 });
  } catch {
    const local = await fromLocal(opts, (till, companyId) =>
      till.courierCollections(companyId, from, to) as Promise<{ nagd: number; kart: number }>);
    return local ?? { nagd: 0, kart: 0 };
  }
}

// Money taken off a courier. `paymentId` is minted by the caller so a retry —
// the offline outbox resending, a double-tap — returns the first payment instead
// of taking the money twice. Passing `shiftId` books it into the drawer in the
// same transaction, but only for 'nağd': a card settlement never entered this
// till, so counting it would leave the drawer short at close.
export async function addCourierPayment(
  courierId: string,
  amount: number,
  createdBy: string,
  staffId: string | null,
  shiftId: string | null,
  note: string,
  paymentId: string,
  method: CourierPayMethod = 'nağd',
): Promise<string | null> {
  const { error } = await supabase.rpc('add_courier_payment', {
    p_courier_id: courierId, p_amount: amount, p_created_by: createdBy || null,
    p_staff_id: staffId, p_shift_id: shiftId, p_note: note || null, p_id: paymentId,
    p_method: method,
  });
  if (error) { console.error('[addCourierPayment]', error); return error.message; }
  return null;
}

// The customer refused the food and the rider brought it back. The only way a
// closed order becomes cancelled — deliberately narrow, see the migration.
export async function returnCourierOrder(orderId: string, reason: string, by: string): Promise<boolean> {
  const local = await toLocal(undefined, `courier-return:${orderId}`, '/api/return-courier-order', { orderId, reason, by });
  if (local) return local.ok;

  const { data, error } = await supabase.rpc('cancel_courier_order', {
    p_order_id: orderId, p_reason: reason, p_by: by,
  });
  if (error) { console.error('[returnCourierOrder]', error.message); return false; }
  return data === true;
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

export async function fetchCompanyBySlug(slug: string): Promise<{ id: string; name: string; logoUrl: string | null; brandColor: string | null } | null> {
  try {
    const { data, error } = await supabase.from('companies').select('id, name, logo_url, brand_color').eq('slug', slug).eq('active', true).single();
    if (error || !data) return null;
    return { id: data.id, name: data.name, logoUrl: data.logo_url ?? null, brandColor: data.brand_color ?? null };
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

/**
 * One of the owner's switches, as this machine last heard it.
 *
 * Every reader below used to query the companies row directly and, on failure,
 * return the permissive answer. RLS refuses that row to a terminal with no
 * session, so on the desktop till every switch failed and every switch came
 * back "on" — an owner who turned Kassa off watched the till keep selling, with
 * nothing anywhere reporting a problem.
 *
 * Null means "this build has no local copy", which sends the caller down the
 * Supabase path it has always taken. See lib/till-sync.ts for what fills it.
 */
async function fromSettings<T>(pick: (s: TillSettings) => T): Promise<T | null> {
  const till = typeof window === 'undefined' ? null : window.posNative?.till;
  if (!till || !_companyId) return null;
  try {
    const { settings } = await till.settings(_companyId);
    return settings ? pick(settings) : null;
  } catch {
    return null;
  }
}

// ─── Tables ───────────────────────────────────────────────────────────────────

// Takeaway-only companies turn tables off: sellers then skip table selection
// entirely and orders are created without a table.
export async function fetchTablesEnabled(): Promise<boolean> {
  const local = await fromSettings(s => s.tablesEnabled);
  if (local !== null) return local;
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

// ─── Branding (logo + accent color) ───────────────────────────────────────────

export async function fetchBranding(): Promise<{ logoUrl: string | null; brandColor: string | null }> {
  const local = await fromSettings(s => ({ logoUrl: s.logoUrl, brandColor: s.brandColor }));
  if (local !== null) return local;
  try {
    if (!_companyId) return { logoUrl: null, brandColor: null };
    const { data, error } = await supabase.from('companies').select('logo_url, brand_color').eq('id', _companyId).single();
    if (error || !data) return { logoUrl: null, brandColor: null };
    return { logoUrl: data.logo_url ?? null, brandColor: data.brand_color ?? null };
  } catch { return { logoUrl: null, brandColor: null }; }
}

export async function setLogoUrl(url: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_logo_url', { url: url ?? '' });
  if (error) console.error('[setLogoUrl]', error);
}

export async function setBrandColor(color: string): Promise<void> {
  const { error } = await supabase.rpc('set_brand_color', { c: color });
  if (error) console.error('[setBrandColor]', error);
}

export async function fetchMenuOnly(): Promise<boolean> {
  const local = await fromSettings(s => s.menuOnly);
  if (local !== null) return local;
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
  const local = await fromSettings(s => s.printReceipt);
  if (local !== null) return local;
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

export async function fetchSoundEnabled(): Promise<boolean> {
  const local = await fromSettings(s => s.soundEnabled);
  if (local !== null) return local;
  try {
    if (!_companyId) return true;
    const { data, error } = await supabase.from('companies').select('sound_enabled').eq('id', _companyId).single();
    if (error || !data) return true;
    return data.sound_enabled !== false;
  } catch { return true; }
}

export async function setSoundEnabled(enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_sound_enabled', { enabled });
  if (error) console.error('[setSoundEnabled]', error);
}

export async function fetchKassaEnabled(): Promise<boolean> {
  const local = await fromSettings(s => s.kassaEnabled);
  if (local !== null) return local;
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

export async function fetchTables(opts?: ReadOpts): Promise<RestaurantTable[]> {
  const local = await fromLocal(opts, async (till, companyId) =>
    ((await till.tables(companyId)) as { tables: RestaurantTable[] }).tables);
  if (local) return local;

  try {
    const { data, error } = await supabase.from('restaurant_tables').select('id, name, capacity, x, y, w, h, shape, hall_id').order('id');
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
      hallId: r.hall_id ?? undefined,
    }));
  } catch { return []; }
}

export async function createTable(name: string, capacity: number, shape: string = 'rect', w?: number, h?: number, hallId?: string | null): Promise<string | null> {
  const { data, error } = await supabase
    .from('restaurant_tables')
    .insert({ name, capacity, shape, w: w ?? null, h: h ?? null, hall_id: hallId ?? null, company_id: _companyId })
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

export async function moveTableToHall(id: number, hallId: string): Promise<void> {
  try {
    await supabase.from('restaurant_tables').update({ hall_id: hallId }).eq('id', id);
  } catch (e) { console.error('[moveTableToHall]', e); }
}

// ─── Zallar ───────────────────────────────────────────────────────────────────

export async function fetchHalls(opts?: ReadOpts): Promise<Hall[]> {
  const local = await fromLocal(opts, async (till, companyId) =>
    ((await till.tables(companyId)) as { halls: Hall[] }).halls);
  if (local) return local;

  try {
    const { data, error } = await supabase.from('halls').select('id, name, position').order('position').order('name');
    if (error || !data) return [];
    return data.map(r => ({ id: r.id, name: r.name, position: r.position ?? 0 }));
  } catch { return []; }
}

export async function createHall(name: string): Promise<{ id?: string; error?: string }> {
  const { data, error } = await supabase
    .from('halls')
    .insert({ name, company_id: _companyId })
    .select('id')
    .single();
  if (error) {
    console.error('[createHall]', error);
    return { error: error.code === '23505' ? 'Bu adda zal artıq var.' : error.message };
  }
  return { id: data.id };
}

export async function renameHall(id: string, name: string): Promise<string | null> {
  const { error } = await supabase.from('halls').update({ name }).eq('id', id);
  if (error) {
    console.error('[renameHall]', error);
    return error.code === '23505' ? 'Bu adda zal artıq var.' : error.message;
  }
  return null;
}

export async function deleteHall(id: string): Promise<string | null> {
  const { error } = await supabase.from('halls').delete().eq('id', id);
  // 23503: restaurant_tables.hall_id still points here — the hall is not empty.
  if (error) {
    console.error('[deleteHall]', error);
    return error.code === '23503' ? 'Bu zalda masalar var — əvvəlcə onları köçürün və ya silin.' : error.message;
  }
  return null;
}

// Tables created before halls existed (or by a company whose first hall is only
// being made now) carry hall_id = null; adopt them into the hall being created.
export async function adoptOrphanTables(hallId: string): Promise<void> {
  try {
    await supabase.from('restaurant_tables').update({ hall_id: hallId }).is('hall_id', null);
  } catch (e) { console.error('[adoptOrphanTables]', e); }
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

export async function updateCompanyExpiry(id: string, expiresAt: string | null): Promise<string | null> {
  const { error } = await supabase.from('companies').update({ expires_at: expiresAt }).eq('id', id);
  if (error) { console.error('[updateCompanyExpiry]', error); return error.message; }
  return null;
}

export async function updateCompanyProfile(id: string, ownerName: string, address: string, phone: string): Promise<string | null> {
  const { error } = await supabase.from('companies').update({ owner_name: ownerName, address, phone }).eq('id', id);
  if (error) { console.error('[updateCompanyProfile]', error); return error.message; }
  return null;
}

// Owner's own profile save — direct updates to companies are superadmin-only
// under RLS, so owners go through a security definer RPC like set_work_hours.
export async function updateMyCompanyProfile(name: string, ownerName: string, address: string, phone: string): Promise<void> {
  const { error } = await supabase.rpc('set_company_profile', { name_t: name, owner_name_t: ownerName, address_t: address, phone_t: phone });
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

export async function updateCompanyTimezone(id: string, timezone: string): Promise<string | null> {
  const { error } = await supabase.from('companies').update({ timezone }).eq('id', id);
  if (error) { console.error('[updateCompanyTimezone]', error); return error.message; }
  return null;
}

export async function fetchCompanyProfile(id: string): Promise<{ name: string; ownerName: string; address: string; phone: string } | null> {
  try {
    const { data, error } = await supabase.from('companies').select('name, owner_name, address, phone').eq('id', id).single();
    if (error || !data) return null;
    return { name: data.name ?? '', ownerName: data.owner_name ?? '', address: data.address ?? '', phone: data.phone ?? '' };
  } catch { return null; }
}

// The session caches the display name but not the login, so the profile modal
// reads it straight from the row — profiles_select allows id = auth.uid().
export async function fetchMyUsername(id: string): Promise<string> {
  try {
    const { data } = await supabase.from('profiles').select('username').eq('id', id).single();
    return data?.username ?? '';
  } catch { return ''; }
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

export async function fetchAllUsers(): Promise<{ id: string; username: string; name: string; role: string; companyId: string | null; active: boolean; createdAt: string; stationId: string | null }[]> {
  try {
    const res = await fetch('/api/users', { headers: await authHeaders() });
    if (!res.ok) return [];
    const data = await res.json();
    return data.map((u: Record<string, unknown>) => ({ id: u.id, username: u.username, name: u.name, role: u.role, companyId: u.company_id ?? null, active: u.active, createdAt: u.created_at, stationId: (u.station_id as string | null) ?? null }));
  } catch { return []; }
}

// ─── Owner: sex employees ─────────────────────────────────────────────────────
// Same /api/users endpoints the superadmin uses — the route decides what an owner
// may do (their own company, sellers and employees only). These just carry the sex.

export async function createEmployee(
  username: string, password: string, name: string, stationId: string,
): Promise<string | null> {
  const res = await fetch('/api/users', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ username, password, name, role: 'employee', stationId }),
  });
  if (!res.ok) {
    const { error } = await res.json();
    return error ?? 'Xəta baş verdi';
  }
  return null;
}

export async function updateEmployee(
  id: string,
  fields: { name?: string; username?: string; password?: string; stationId?: string },
): Promise<string | null> {
  const res = await fetch(`/api/users/${id}`, {
    method: 'PATCH',
    headers: await authHeaders(),
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    const { error } = await res.json();
    return error ?? 'Xəta baş verdi';
  }
  return null;
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
  card_sales: number | null; counted_card: number | null; movements: unknown; edits?: unknown;
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
    edits: Array.isArray(r.edits) ? (r.edits as ShiftEdit[]) : [],
  };
}

export async function fetchOpenShift(opts?: ReadOpts): Promise<CashShift | null> {
  // A null shift is a real answer here — most of the day there is no open shift
  // — so this cannot use the `?? fall through` shape the others do.
  const till = localTill(opts);
  if (till && _companyId) {
    try {
      return ((await till.shift(_companyId)) as { shift: CashShift | null }).shift;
    } catch { /* broken local copy: ask the server */ }
  }

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
  // The till chooses the id and the opening time so a shift can begin with no
  // line at all: receipts and cash movements reference this id straight away,
  // and app/api/open-shift honours both when the insert is finally replayed.
  const shiftId = crypto.randomUUID();
  const openedAt = new Date().toISOString();
  const local = await toLocal(undefined, `shift:${shiftId}`, '/api/open-shift', {
    openingCash, openedBy, shiftId, openedAt,
  });
  if (local) {
    if (!local.ok) return fetchOpenShift();   // someone already opened one
    return { id: shiftId, openedAt, openedBy, openingCash, movements: [], edits: [] };
  }

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
  // The movement already carries the id an admin uses to correct it later, which
  // makes it exactly the right idempotency key — append_shift_movement appends
  // unconditionally, so a replay without one leaves the drawer short at close.
  const local = movement.id
    ? await toLocal(undefined, `movement:${movement.id}`, '/api/add-shift-movement', { shiftId, movement })
    : null;
  if (local) return;

  // Atomic jsonb append in the DB — concurrent movements can't overwrite each other
  const { error } = await supabase.rpc('append_shift_movement', { shift_id: shiftId, movement });
  if (error) console.error('[addShiftMovement]', error);
}

// ── Admin corrections ────────────────────────────────────────────────────────
// Each RPC applies the change and appends its audit entry in one statement, so
// a shift can never be edited without a trail. These return the error text
// instead of swallowing it: a correction that silently fails would leave the
// admin believing the books are fixed when they aren't.

export async function updateShiftMovement(
  shiftId: string, movementId: string, amount: number, reason: string, by: string,
): Promise<string | null> {
  const { error } = await supabase.rpc('update_shift_movement', {
    shift_id: shiftId, movement_id: movementId,
    new_amount: amount, new_reason: reason, by_name: by,
  });
  if (error) { console.error('[updateShiftMovement]', error); return error.message; }
  return null;
}

export async function deleteShiftMovement(
  shiftId: string, movementId: string, by: string,
): Promise<string | null> {
  const { error } = await supabase.rpc('delete_shift_movement', {
    shift_id: shiftId, movement_id: movementId, by_name: by,
  });
  if (error) { console.error('[deleteShiftMovement]', error); return error.message; }
  return null;
}

// Closed shifts only — expected_cash stays derived and is never passed in.
export async function correctShiftTotals(
  shiftId: string, countedCash: number, countedCard: number | null, by: string,
): Promise<string | null> {
  const { error } = await supabase.rpc('correct_shift_totals', {
    shift_id: shiftId,
    new_counted_cash: countedCash, new_counted_card: countedCard, by_name: by,
  });
  if (error) { console.error('[correctShiftTotals]', error); return error.message; }
  return null;
}

export async function closeShift(
  shiftId: string, expectedCash: number, countedCash: number, closedBy: string,
  cardSales?: number, countedCard?: number,
): Promise<void> {
  // The seller screen already refuses to close while the line is down or the
  // outbox is not empty — see handleCloseShift — so this lands locally and is
  // replayed within seconds, keeping the till's own record in step with what
  // was sent rather than a shift that reads open until the next pull.
  const local = await toLocal(undefined, `close:${shiftId}`, '/api/close-shift', {
    shiftId, expectedCash, countedCash, closedBy, cardSales, countedCard,
  });
  if (local) return;

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
export async function fetchShiftSales(openedAt: string, opts?: ReadOpts): Promise<{ cash: number; card: number }> {
  // Payments made during an outage exist only on this machine until they sync,
  // so a drawer reconciled against the server would read short by exactly what
  // the till took while the line was down.
  const local = await fromLocal(opts, (till, companyId) =>
    till.shiftSales(companyId, openedAt) as Promise<{ cash: number; card: number }>);
  if (local) return local;

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

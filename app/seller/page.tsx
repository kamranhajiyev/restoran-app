'use client';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  PanelLeftClose, PanelLeftOpen, LogOut, X,
  Receipt, Coffee, ShoppingBag, UtensilsCrossed,
  ShoppingCart, ChevronLeft, ChevronRight, ChevronDown, Minus, Plus, Wallet,
  History, Search, Delete, KeyRound, Trash2, Check, Bell, BellOff, AlertTriangle, Printer,
} from 'lucide-react';
import { getSession, logout, validateSession, clearLocalSession, homeFor } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import {
  fetchMenu, addOrder, addItemsToOrder, setOrderItemQuantity, fetchOrders, fetchOrdersCount, updateOrderStatus, cancelOrder, moveOrderTable, fetchCategories, setCompanyContext, fetchTables, fetchHalls,
  fetchTablesEnabled, fetchKassaEnabled, fetchOpenShift, openShift, closeShift, addShiftMovement, fetchShiftSales,
  fetchCompanySettings, fetchStaff, verifyStaffPin, getDeviceId, fetchPrintReceipt, setPrintReceiptEnabled, fetchBranding,
  fetchSoundEnabled, fetchFailedPrintOrders, retryPrintJobs,
  fetchStations, fetchStationReady, fetchModifierGroups, type StationReady,
} from '@/lib/store';
import { menuIndex, stationForItem, readyStationIds } from '@/lib/stations';
import { unlockSound, armSoundOnFirstGesture, playOrderReady } from '@/lib/sound';
import { applyBrand } from '@/lib/branding';
import { orderClosedAt } from '@/lib/order-items';
import { CompanySettings, DEFAULT_SETTINGS, businessDay, businessToday, businessDayStartUtc } from '@/lib/business-day';
import { CashShift, Category, Hall, MenuItem, ModifierGroup, Order, OrderItem, OrderStatus, RestaurantTable, SelectedModifier, ShiftMovement, Staff, Station, isOrderOpen } from '@/types';
import InstallPWA from '@/components/InstallPWA';
import OrderItemHistory from '@/components/OrderItemHistory';
import { connectPrinter, disconnectPrinter, selectPrinter, printBill, printReceipt, openCashDrawer } from '@/lib/printer';
import { isDesktop, startKitchenPrinting } from '@/lib/desktopPrint';
import { postOrQueue, isOnline, startConnectivityWatch, onConnectivityChange } from '@/lib/offline-net';
import { tillFetch, hasLocalDb } from '@/lib/till-data';
import { hasLocalData, pullAll } from '@/lib/till-sync';
import TillSetup from '@/components/TillSetup';
import SyncStatus from '@/components/SyncStatus';
import TillLink from '@/components/TillLink';
import { canLink, checkLink, clearLink, readLink, saveLink, type Terminal } from '@/lib/terminal-link';
import { tillImage } from '@/lib/till-image';
import { orderLabel, orderSearchText } from '@/lib/order-label';
import { flushQueue, ADD_ORDER } from '@/lib/sync';
import { verifyPinOffline, rememberPin, forgetPins } from '@/lib/offline-pin';
import { queueSize, enqueue } from '@/lib/offline-queue';
import { pendingWrites } from '@/lib/till-write';

// How many writes the server has not seen. Two stores answer that question — the
// browser till's IndexedDB queue and the desktop till's SQLite outbox — but only
// one of them exists on any given machine, and the badge and the shift-close
// guard want a single number either way.
async function pendingTotal(): Promise<number> {
  return hasLocalDb() ? pendingWrites() : queueSize();
}

// How often the desktop till refreshes its copy of the restaurant. Long, because
// it is a full re-read of the menu and the room: the things it catches — a price
// edited in the office, a table another terminal seated — are not things a waiter
// is standing there waiting for.
const PULL_EVERY_MS = 5 * 60_000;

const CANCEL_REASONS =['Müştəri imtina etdi', 'Səhv sifariş', 'Məhsul yoxdur', 'Digər'];

const AZ_CHARS: Record<string, string> = { 'ç': 'c', 'ə': 'e', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u' };
function azNormalize(s: string): string {
  return s.toLocaleLowerCase('az').replace(/[çəğıöşü]/g, ch => AZ_CHARS[ch]);
}

// The station panel reads tables over the public API, which hands back raw DB
// rows (hall_id, not hallId) — bring them to the shape the rest of the page uses.
type ApiTableRow = Omit<RestaurantTable, 'hallId'> & { hall_id?: string | null };
function normalizeTables(rows: ApiTableRow[]): RestaurantTable[] {
  return rows.map(({ hall_id, ...t }) => ({ ...t, hallId: hall_id ?? undefined }));
}

type View = 'orders' | 'new-order' | 'menu' | 'kassa' | 'history';
type PayMethod = 'nağd' | 'kart';
type OrderType = 'masa' | 'takeaway';

const STATUS_COLORS: Record<OrderStatus, string> = {
  'gözləyir':  'bg-primary-100 text-primary-700',
  'hazırlanır':'bg-blue-100 text-blue-700',
  'hazırdır':  'bg-green-100 text-green-700',
  'ödənilib':  'bg-stone-100 text-stone-600',
  'ləğv edildi': 'bg-red-100 text-red-600',
  'silinib':   'bg-red-100 text-red-600',
};
const STATUS_LABELS: Record<OrderStatus, string> = {
  'gözləyir':   'gözləyir',
  'hazırlanır': 'hazırlanır',
  'hazırdır':   'hazırdır',
  'ödənilib':   'ödənilib',
  'ləğv edildi':'ödənişsiz bağlandı',
  'silinib':    'silinib',
};

function elapsed(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins} dəq`;
  return `${Math.floor(mins / 60)} saat`;
}

function orderTotal(order: Order): number {
  const gross = order.items.reduce((s, oi) => s + oi.menuItem.price * oi.quantity, 0);
  return gross - (order.discountAmount ?? 0);
}

function tableHasActive(n: number, orders: Order[]): boolean {
  return orders.some(o => o.tableNumber === n && isOrderOpen(o));
}

export interface SellerProps {
  overrideCompanyId?: string;
  overrideCompanyName?: string;
  overrideToken?: string;
  overrideLogoUrl?: string | null;
  overrideBrandColor?: string | null;
  overrideExpiresAt?: string | null;
}

// ── How this page is entered ─────────────────────────────────────────────────
// Three ways, and the till below is identical in all three:
//
//   · /seller in a browser, signed in as a waiter — no props.
//   · /s/<slug>/<token>, a terminal with no account — that route resolves the
//     link and passes it down as props.
//   · the Windows app, which has no address bar. It opens app://till/seller
//     every time and asks the machine which terminal it was set up as, which is
//     the same two values from the same link, pasted once (components/TillLink).
//
// The wrapper exists to keep the third case out of the till: resolving a link
// is asynchronous, and the props below are read by state initialisers that run
// once. Deciding before the till mounts is what makes an outage open at the PIN
// pad instead of at a setup screen.
export default function SellerRoute(props: SellerProps = {}) {
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  // undefined until the machine has been asked. Both the server render and the
  // first client render see it, so there is nothing to mismatch on hydration.
  const [linked, setLinked] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let live = true;
    // A browser, or a route that already knows its terminal: nothing to look up.
    // A machine someone has signed into with an account is also already answered
    // — the link is the way in for a till that has no account, not a replacement
    // for the one it has.
    const skip = Boolean(props.overrideCompanyId) || !canLink() || getSession() !== null;

    void (skip ? Promise.resolve(null) : readLink()).then(stored => {
      if (!live) return;
      setTerminal(stored);
      setLinked(skip || stored !== null);
      if (!stored) return;

      // Revalidate in the background — the till is already open by then. A
      // revoked link stops this machine the moment the server can say so; an
      // outage changes nothing, which is the whole point of storing the answer.
      // The till's own number is carried in, not fetched: it is a fact about
      // which counter this machine sits on, which the server has no way to know.
      // Omitting it here would quietly reset every second till to 1 on the first
      // refresh after it was set up.
      void checkLink(stored.slug, stored.token, stored.tillNumber).then(async result => {
        if (result.status === 'offline') return;
        if (result.status === 'invalid') {
          await clearLink();
          if (!live) return;
          setTerminal(null);
          setLinked(false);
          return;
        }
        await saveLink(result.terminal);
      });
    });

    return () => { live = false; };
  }, [props.overrideCompanyId]);

  // One frame, on the desktop only, while SQLite answers.
  if (linked === undefined) return null;

  if (!linked) {
    return <TillLink onLinked={t => { setTerminal(t); setLinked(true); }} />;
  }

  return terminal
    ? (
      <SellerPage
        overrideCompanyId={terminal.companyId}
        overrideCompanyName={terminal.companyName}
        overrideToken={terminal.token}
        overrideLogoUrl={terminal.logoUrl}
        overrideBrandColor={terminal.brandColor}
        overrideExpiresAt={terminal.expiresAt}
      />
    )
    : <SellerPage {...props} />;
}

export function SellerPage({ overrideCompanyId, overrideCompanyName, overrideToken, overrideLogoUrl, overrideBrandColor, overrideExpiresAt }: SellerProps = {}) {
  const router = useRouter();
  const [logoUrl, setLogoUrl] = useState<string | null>(overrideLogoUrl ?? null);
  const [view, setView]             = useState<View>('orders');
  const [menu, setMenu]             = useState<MenuItem[]>([]);
  const [availableCategories, setAvailableCategories] = useState<Category[]>([]);
  const [orders, setOrders]         = useState<Order[]>([]);
  const [sellerName, setSellerName] = useState('Satıcı');
  const [online, setOnline]         = useState(true);
  const [collapsed, setCollapsed]   = useState(false);

  // new order
  const [tables, setTables]                 = useState<RestaurantTable[]>([]);
  const [halls, setHalls]                   = useState<Hall[]>([]);
  const [activeHallId, setActiveHallId]     = useState<string | null>(null);
  // Tables off (takeaway-only company): the Masa/Takeaway screen is skipped and
  // "Yeni sifariş" opens the product menu directly
  const [tablesOn, setTablesOn]             = useState(true);
  const [kassaOn, setKassaOn]               = useState(false);
  const [orderType, setOrderType]           = useState<OrderType | null>(null);
  const [selectedTable, setSelectedTable]   = useState<number | null>(null);
  const [cart, setCart]                     = useState<OrderItem[]>([]);
  const [activeCategory, setActiveCategory] = useState('');
  const [note, setNote]                     = useState('');
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [submitting, setSubmitting]         = useState(false);

  // What is waiting on the line. A waiter who cannot tell the difference between
  // "saved" and "saved here only" will close the till on an unsent shift.
  // (`online` above already drives the Oflayn badge; the watch below keeps it
  // honest instead of leaving it stuck on the last page load's result.)
  const [pendingCount, setPendingCount] = useState(0);
  // A flush is on the wire right now. Only the badge cares — nothing waits on it.
  const [sending, setSending] = useState(false);

  // Poster-style PIN lock
  const [pinStaffList, setPinStaffList] = useState<Staff[]>([]);
  const [activeStaff, setActiveStaff]   = useState<{ id: string; name: string } | null>(() => {
    try {
      const saved = sessionStorage.getItem('activeStaff');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [pinInput, setPinInput]         = useState('');
  const [pinBusy, setPinBusy]           = useState(false);
  const [pinMsg, setPinMsg]             = useState('');

  // ── First run on a new machine ──────────────────────────────────────────────
  // Only the desktop build has a local database, and only an empty one needs
  // filling. In a browser tab needsSetup never becomes true and none of this
  // costs anything.
  const [needsSetup, setNeedsSetup] = useState(false);
  const [setupCompanyId, setSetupCompanyId] = useState<string | null>(null);
  // Bumped when the pull finishes, to send the loader below back for the data
  // that has just landed — it will have read an empty database a moment ago.
  const [dataVersion, setDataVersion] = useState(0);

  useEffect(() => {
    if (!hasLocalDb()) return;
    const companyId = overrideCompanyId ?? getSession()?.companyId ?? null;
    if (!companyId) return;
    setSetupCompanyId(companyId);
    void hasLocalData(companyId).then(filled => setNeedsSetup(!filled));
  }, [overrideCompanyId]);

  const pinEnabled = pinStaffList.some(s => s.active);
  const pinLocked  = pinEnabled && !activeStaff;
  const effectiveSeller = activeStaff?.name ?? sellerName;

  async function pressPin(digit: string) {
    if (pinBusy || pinInput.length >= 4) return;
    const next = pinInput + digit;
    setPinInput(next);
    setPinMsg('');
    if (next.length < 4) return;
    setPinBusy(true);
    const deviceId = getDeviceId();
    // Public terminal has no Supabase session — verify via server-side API route
    const res = overrideCompanyId
      ? isOnline()
        ? await fetch('/api/verify-pin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companyId: overrideCompanyId, pin: next, token: overrideToken, deviceId }),
          }).then(r => r.json()).catch(() => ({ ok: false, error: 'network' }))
        // Nobody to ask. Fall back to what this machine remembers from a
        // successful unlock earlier — see lib/offline-pin.ts for what that
        // does and does not protect.
        : await verifyPinOffline(next, overrideCompanyId)
      : await verifyStaffPin(next, deviceId);
    setPinBusy(false);
    setPinInput('');
    if (res.ok) {
      const staff = { id: res.id, name: res.name };
      // Only the server's word is worth remembering; re-storing an offline
      // unlock would let a cached record refresh itself indefinitely.
      if (overrideCompanyId && isOnline()) void rememberPin(next, staff, overrideCompanyId);
      sessionStorage.setItem('activeStaff', JSON.stringify(staff));
      setActiveStaff(staff);
    } else if (res.error === 'wrong') {
      setPinMsg(`Yanlış PIN${res.attemptsLeft > 0 ? ` · ${res.attemptsLeft} cəhd qaldı` : ''}`);
    } else if (res.error === 'unavailable') {
      // Offline and this waiter has not unlocked on this machine before, so
      // there is nothing to check against. Say that, rather than "wrong PIN".
      setPinMsg('Oflayn — bu cihazda əvvəlcə onlayn daxil olun');
    } else if (res.error === 'locked') {
      const until = res.locked_until ? new Date(res.locked_until) : null;
      const mins = until ? Math.ceil((until.getTime() - Date.now()) / 60000) : '?';
      setPinMsg(`Çox sayda yanlış cəhd — ${mins} dəqiqə gözləyin`);
    } else {
      setPinMsg('Şəbəkə xətası, yenidən cəhd edin');
    }
  }

  // Hardware keyboard on the lock screen (desktop terminals)
  useEffect(() => { setExpiresAt(getSession()?.expiresAt ?? null); }, []);
  useEffect(() => {
    connectPrinter().then(setPrinterConnected);
    return () => { disconnectPrinter(); };
  }, []);

  useEffect(() => {
    if (!pinLocked) return;
    const h = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) pressPin(e.key);
      else if (e.key === 'Backspace') setPinInput(p => p.slice(0, -1));
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinLocked, pinInput, pinBusy]);

  // Always start PIN screen with a clean slate
  useEffect(() => {
    if (pinLocked) { setPinInput(''); setPinMsg(''); }
  }, [pinLocked]);

  // Kick out an already-logged-in seller who gets deactivated (or deleted) while inside the app.
  // The staff list is refreshed by the terminal poll / focus sync; if the active seller is no
  // longer present-and-active there, clear the session so they drop to the PIN lock screen.
  // Only act on a non-empty list so a transient failed fetch can't force a false logout.
  useEffect(() => {
    if (!activeStaff || pinStaffList.length === 0) return;
    const stillValid = pinStaffList.some(s => s.id === activeStaff.id && s.active);
    if (!stillValid) {
      sessionStorage.removeItem('activeStaff');
      setActiveStaff(null);
    }
  }, [pinStaffList, activeStaff]);

  // order history
  const [historySearch, setHistorySearch]   = useState('');
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  // when set, the menu view appends items to this existing order instead of creating a new one
  const [appendOrderId, setAppendOrderId]   = useState<string | null>(null);
  // brief confirmation shown after an existing line's quantity is edited/removed on the server
  const [savedToast, setSavedToast]         = useState(false);
  const savedToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function flashSaved() {
    setSavedToast(true);
    if (savedToastTimer.current) clearTimeout(savedToastTimer.current);
    savedToastTimer.current = setTimeout(() => setSavedToast(false), 1600);
  }
  const [totalOrders, setTotalOrders]       = useState(0);
  const [historyOrders, setHistoryOrders]   = useState<Order[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loadingMore, setLoadingMore]       = useState(false);

  // cancel modal — preset reason required, free text only for "Digər"
  const [cancellingOrder, setCancellingOrder] = useState<Order | null>(null);
  const [cancelReason, setCancelReason]       = useState<string | null>(null);
  const [cancelOtherText, setCancelOtherText] = useState('');
  const [cancelBusy, setCancelBusy]           = useState(false);

  // move-table modal — a busy target needs a second tap to confirm
  const [movingOrder, setMovingOrder]   = useState<Order | null>(null);
  const [moveTarget, setMoveTarget]     = useState<number | null>(null);
  const [moveBusy, setMoveBusy]         = useState(false);

  // payment modal
  const [payingOrder, setPayingOrder] = useState<Order | null>(null);
  const [cashInput, setCashInput]     = useState('');
  const [cardInput, setCardInput]     = useState('');
  const [discountInput, setDiscountInput] = useState('');
  const [discountType, setDiscountType]   = useState<'%' | '₼'>('₼');

  // kassa (cash shift)
  const [shift, setShift]               = useState<CashShift | null>(null);
  const [shiftChecked, setShiftChecked] = useState(false);
  const [openCashInput, setOpenCashInput] = useState('');
  const [shiftBusy, setShiftBusy]       = useState(false);
  const [shiftSales, setShiftSales]     = useState({ cash: 0, card: 0 });
  const [countedInput, setCountedInput] = useState('');
  const [terminalInput, setTerminalInput] = useState('');
  const [movAmount, setMovAmount]       = useState('');
  const [movReason, setMovReason]       = useState('');
  const [movOut, setMovOut]             = useState(true);
  const [showMovForm, setShowMovForm]   = useState(false);
  const [justClosed, setJustClosed]     = useState(false);

  const [menuSearch, setMenuSearch] = useState('');
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [printerConnected, setPrinterConnected] = useState(false);
  const [shouldPrintReceipt, setShouldPrintReceipt] = useState(true);
  // Which order's bill is on its way to the printer. Holds the id rather than a
  // flag so only that row's button goes quiet — pairing shows a browser dialog,
  // and a second press behind it would queue a duplicate bill.
  const [printBillBusy, setPrintBillBusy] = useState<string | null>(null);

  // modifier / variant modal
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [modifierItem, setModifierItem] = useState<MenuItem | null>(null);
  // group id → the option ids picked in it. A pick-one group holds at most one.
  const [selectedMods, setSelectedMods] = useState<Record<string, string[]>>({});
  const [selectedVariant, setSelectedVariant] = useState<{ id: string; name: string; price: number } | null>(null);

  // Company timezone + working hours: "Bu gün" follows the business day, so a
  // night shift's post-midnight orders stay under today until closing time
  const [bizSettings, setBizSettings] = useState<CompanySettings>(DEFAULT_SETTINGS);

  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  const catScrollRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef<number | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const PULL_THRESHOLD = 72;

  const refreshAll = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setPullRefreshing(true);
    try {
      if (overrideCompanyId) {
        const [m, o, c, tb, st, rd, mg] = await Promise.all([
          tillFetch(`/api/public-menu?companyId=${overrideCompanyId}`).then(r => r.json()).then(d => d.items ?? []).catch(() => []),
          tillFetch(`/api/public-orders?companyId=${overrideCompanyId}&limit=200`).then(r => r.json()).then(d => d.orders ?? []).catch(() => []),
          tillFetch(`/api/public-categories?companyId=${overrideCompanyId}`).then(r => r.json()).then(d => d.categories ?? []).catch(() => []),
          tillFetch(`/api/public-tables?companyId=${overrideCompanyId}`).then(r => r.json()).then(d => ({ tables: normalizeTables(d.tables ?? []), halls: (d.halls ?? []) as Hall[] })).catch(() => ({ tables: [], halls: [] })),
          tillFetch(`/api/public-staff?companyId=${overrideCompanyId}`).then(r => r.json()).then(d => d.staff ?? []).catch(() => null),
          tillFetch(`/api/public-station-ready?companyId=${overrideCompanyId}`).then(r => r.json()).then(d => d.ready ?? []).catch(() => null),
          tillFetch(`/api/public-modifiers?companyId=${overrideCompanyId}`).then(r => r.json()).then(d => d.groups ?? null).catch(() => null),
        ]);
        setMenu(m); setOrders(o); setTables(tb.tables); setHalls(tb.halls);
        setAvailableCategories(c.filter((cat: { available: boolean }) => cat.available));
        if (st) setPinStaffList(st);
        if (rd) setReadyRows(rd);
        // Keep the sets already in hand if the read failed: an empty list would
        // silently drop priced options off the next sale.
        if (mg) setModifierGroups(mg);
      } else {
        const [m, o, c, st, s, mg, tb, hl] = await Promise.all([
          fetchMenu(), fetchOrders({ limit: 200 }), fetchCategories(), fetchStaff(), fetchOpenShift(), fetchModifierGroups(),
          fetchTables(), fetchHalls(),
        ]);
        setMenu(m); setOrders(o); setShift(s); setTables(tb); setHalls(hl);
        setAvailableCategories(c.filter(cat => cat.available));
        setPinStaffList(st);
        setModifierGroups(mg);
      }
    } catch { /* ignore */ } finally {
      if (!silent) setPullRefreshing(false);
    }
  }, [overrideCompanyId]);

  const [refreshing, setRefreshing] = useState(false);
  const refreshOrders = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) setRefreshing(true);
    try {
      if (overrideCompanyId) {
        const [d, r] = await Promise.all([
          // null, not an empty list: offline these two are indistinguishable, and
          // treating a dead line as "this restaurant has no open orders" wipes
          // every occupied table off the screen mid-service.
          tillFetch(`/api/public-orders?companyId=${overrideCompanyId}&limit=200`).then(r => r.json()).catch(() => null),
          tillFetch(`/api/public-station-ready?companyId=${overrideCompanyId}`).then(r => r.json()).then(d => d.ready ?? []).catch(() => null),
        ]);
        if (d) { setOrders(d.orders ?? []); setTotalOrders(d.total ?? 0); }
        // null = the request failed. Keep the last known green rather than blanking
        // the list: a blip must not make ready food look unready.
        if (r) setReadyRows(r);
      } else {
        const [o, total, r] = await Promise.all([fetchOrders({ limit: 200 }), fetchOrdersCount(), fetchStationReady()]);
        setOrders(o); setTotalOrders(total); setReadyRows(r);
      }
    } finally { if (!silent) setRefreshing(false); }
  }, [overrideCompanyId]);

  // ── The line ────────────────────────────────────────────────────────────────
  // Watch the connection for as long as the till is open, and the moment it comes
  // back, send everything that piled up — then re-read, so the screen shows what
  // the server actually has rather than the till's optimistic copy of it.
  useEffect(() => {
    const stop = startConnectivityWatch();
    void pendingTotal().then(setPendingCount);

    const off = onConnectivityChange(async up => {
      setOnline(up);
      if (!up) return;
      setSending(true);
      try {
        await flushQueue(overrideCompanyId ?? null);
      } finally {
        setSending(false);
      }
      const left = await pendingTotal();
      setPendingCount(left);
      if (left !== 0) return;

      // Push before pull, always. The desktop till reads from its own database,
      // so re-reading after a flush would only show it its own copy back. What
      // it actually needs is the server's — the price the owner changed, the
      // table the other terminal seated — and pulling that on top of writes that
      // have not left yet would overwrite them with the server's older answer.
      // Hence the gate above: nothing is pulled until the outbox is empty.
      const companyId = overrideCompanyId ?? getSession()?.companyId ?? null;
      if (hasLocalDb() && companyId) {
        await pullAll(companyId);
        setDataVersion(v => v + 1);
      }
      void refreshOrders({ silent: true });
    });

    return () => { stop(); off(); };
  }, [overrideCompanyId, refreshOrders]);

  // While the line stays up nothing above ever fires again — onConnectivityChange
  // reports transitions, and a till that opens online and stays online would run
  // on the copy it pulled this morning. A quiet refresh on a timer is what keeps
  // a price change and another terminal's orders arriving during service.
  useEffect(() => {
    if (!hasLocalDb()) return;
    const companyId = overrideCompanyId ?? getSession()?.companyId ?? null;
    if (!companyId) return;

    const t = setInterval(async () => {
      if (!isOnline()) return;
      // Same rule as above: never pull over writes that have not been sent.
      setSending(true);
      try {
        await flushQueue(companyId);
      } finally {
        setSending(false);
      }
      const left = await pendingTotal();
      setPendingCount(left);
      if (left !== 0) return;
      await pullAll(companyId);
      setDataVersion(v => v + 1);
      void refreshOrders({ silent: true });
    }, PULL_EVERY_MS);

    return () => clearInterval(t);
  }, [overrideCompanyId, refreshOrders]);

  // The badge would otherwise only move on a connection change, leaving a waiter
  // watching a stale "3 waiting" while the queue drains.
  useEffect(() => {
    if (online && pendingCount === 0) return;
    const t = setInterval(() => void pendingTotal().then(setPendingCount), 3000);
    return () => clearInterval(t);
  }, [online, pendingCount]);

  // Which sex has finished its part of which order. The sexes themselves are needed
  // to work out which sex owns a line — an order line only carries menu_item_id.
  const [stations, setStations] = useState<Station[]>([]);
  const [readyRows, setReadyRows] = useState<StationReady[]>([]);

  // ── Order alerts ────────────────────────────────────────────────────────────
  // This screen makes exactly one sound: "the food is ready". Orders being punched
  // in or lines being deleted are the kitchen's business, and beep on the sex
  // screen they were sent to — a waiter has no use for another waiter's tap.
  //
  // Detection diffs the ready rows rather than reading realtime payloads, because
  // every path — realtime push (authed) and the 40s poll (public terminal) — lands
  // in the same state. One mechanism covers both modes.
  const [soundOn, setSoundOn] = useState(false);              // company-wide, admin-controlled
  const [deviceMuted, setDeviceMuted] = useState(false);      // this device only
  const [soundReady, setSoundReady] = useState(false);        // browser has allowed audio
  // Only true once asking the waiter is the last resort left: a real gesture came and
  // the browser still refused, a beep died mid-shift, or nobody has touched an idle
  // screen at all. The banner hangs off this, not off !soundReady, so an ordinary
  // waiter — who arms the sound with his first tap — never sees it.
  const [soundBlocked, setSoundBlocked] = useState(false);
  const soundWanted = soundOn && !deviceMuted;

  // Whether the tab is in front, so the "food ready" diff below can hold a missed chime
  // until the waiter looks back instead of swallowing it while hidden.
  const [pageVisible, setPageVisible] = useState(true);
  useEffect(() => {
    const onVis = () => setPageVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // The mute flag is read here rather than in a useState initializer: /seller is
  // prerendered, and a server-rendered "unmuted" that flips to "muted" on hydrate
  // is a mismatch.
  useEffect(() => {
    fetchSoundEnabled().then(on => {
      setSoundOn(on);
      setDeviceMuted(localStorage.getItem('soundMuted') === '1');
    });
  }, [overrideCompanyId]);

  // ── "Food is ready" ─────────────────────────────────────────────────────────
  // The seller has ten orders on screen and one sex just finished its part of the
  // seventh. Without a sound he finds out when the food is cold.
  //
  // Keyed on order+sex, not a count: a row deleted by an undo and a different sex
  // finishing would leave the total unchanged and swallow the second alert.
  const seenReady = useRef<Set<string> | null>(null);
  useEffect(() => {
    const key = (r: StationReady) => `${r.orderId}:${r.stationId}`;
    const current = new Set(readyRows.map(key));
    const prev = seenReady.current;
    if (!prev) { seenReady.current = current; return; }  // first load — no backlog chime
    if (!soundWanted) { seenReady.current = current; return; }
    // A hidden tab cannot make a sound — the browser suspends the audio engine. Don't
    // advance the snapshot while hidden: hold the ready rows that arrived so the chime
    // fires the instant the waiter looks back (the catch-up beep), instead of being
    // silently marked seen and lost. OS push covers the truly-away case; this covers
    // the return. Re-runs on pageVisible so the held rows chime the moment we're back.
    if (document.visibilityState === 'hidden') return;
    seenReady.current = current;
    if (!soundReady) return;
    // Only orders still on the list: a paid order dropping out of the 200-row window
    // takes its ready rows with it, and that is not news.
    const openIds = new Set(orders.filter(isOrderOpen).map(o => o.id));
    for (const k of current) {
      if (!prev.has(k) && openIds.has(k.slice(0, k.lastIndexOf(':')))) {
        playOrderReady().then(ok => { if (!ok) { setSoundReady(false); setSoundBlocked(true); } });
        break;                       // one chime per refresh, however many sexes finished
      }
    }
  }, [readyRows, orders, soundWanted, soundReady, pageVisible]);

  // ── Failed station tickets ──────────────────────────────────────────────────
  // The agent gives up after five attempts. If the waiter isn't told, the order
  // simply never gets cooked and nobody finds out until the customer asks.
  const [printFailed, setPrintFailed] = useState<Set<string>>(new Set());

  useEffect(() => {
    // print_jobs is behind RLS, so this needs a session — which the terminal link
    // has whenever it runs on a machine somebody signed in on, the register being
    // exactly that. Without one the query returns nothing rather than failing, but
    // asking at all is pointless.
    const companyId = getSession()?.companyId;
    if (!companyId || (overrideCompanyId && overrideCompanyId !== companyId)) return;
    let alive = true;
    fetchFailedPrintOrders().then(ids => { if (alive) setPrintFailed(new Set(ids)); });
    return () => { alive = false; };
  }, [overrideCompanyId, orders]);

  async function handleReprint(orderId: string) {
    const err = await retryPrintJobs(orderId);
    if (err) { alert('Yenidən çap alınmadı: ' + err); return; }
    setPrintFailed(prev => { const next = new Set(prev); next.delete(orderId); return next; });
    flashSaved();
    // The agent may fail again on a still-dead printer, so don't just trust the
    // optimistic clear — re-check once it has had time to try.
    setTimeout(() => { fetchFailedPrintOrders().then(ids => setPrintFailed(new Set(ids))); }, 8000);
  }

  async function enableSound() {
    const ok = await unlockSound();
    setSoundReady(ok);
    setSoundBlocked(!ok);
    if (ok) { setDeviceMuted(false); localStorage.removeItem('soundMuted'); }
  }

  // Arm the audio engine off whatever the waiter taps first — an order, Yenilə, the PIN
  // pad — instead of making him dismiss a banner to grant a permission he grants anyway
  // by working. The immediate unlockSound() covers a reload of a page already gestured
  // on; the listener covers a cold open.
  //
  // The timer is for the case a gesture never comes: a tablet left on a shelf would
  // otherwise sit silent with nothing on screen explaining why. After 10s untouched we
  // put the banner up, which is both the explanation and the tap we need.
  useEffect(() => {
    if (!soundWanted || soundReady) return;
    let alive = true;
    const armed = (ok: boolean) => {
      if (!alive || !ok) return;
      clearTimeout(timer);
      setSoundReady(true);
      setSoundBlocked(false);
    };
    const timer = setTimeout(() => { if (alive) setSoundBlocked(true); }, 10000);
    unlockSound().then(armed);
    const off = armSoundOnFirstGesture(armed);
    return () => { alive = false; clearTimeout(timer); off(); };
  }, [soundWanted, soundReady]);

  // Coming back to the screen after a lock / app-switch is exactly when iOS has
  // suspended (or zombified) the audio engine. Re-arm it the moment the tab is
  // visible again, so the next order chimes instead of us waiting for a play to
  // fail first. unlockSound() rebuilds a dead context; a real failure leaves soundReady
  // off, and the effect above is still listening for the next tap to try again.
  useEffect(() => {
    if (!soundWanted) return;
    const rearm = () => {
      if (document.visibilityState !== 'visible') return;
      unlockSound().then(ok => { setSoundReady(ok); if (ok) setSoundBlocked(false); });
    };
    window.addEventListener('focus', rearm);
    document.addEventListener('visibilitychange', rearm);
    return () => {
      window.removeEventListener('focus', rearm);
      document.removeEventListener('visibilitychange', rearm);
    };
  }, [soundWanted]);

  function muteDevice() {
    setDeviceMuted(true);
    localStorage.setItem('soundMuted', '1');
  }

  useEffect(() => {
    if (overrideCompanyId) {
      // Public terminal mode — company context comes from the secret URL token,
      // no Supabase auth session required.
      setCompanyContext(overrideCompanyId);
      setSellerName(overrideCompanyName ?? 'Satıcı');
      applyBrand(overrideBrandColor);
      // No session here, so the expiry the banner reads has to be handed in by the
      // route. Without it the terminal is the one screen that never warns.
      setExpiresAt(overrideExpiresAt ?? null);
      fetchCompanySettings(overrideCompanyId).then(setBizSettings);
      tillFetch(`/api/public-orders?companyId=${overrideCompanyId}&limit=1`)
        .then(r => r.json()).then(d => setTotalOrders(d.total ?? 0)).catch(() => {});
      // Sexes change about once a year — fetched once at boot, not per refresh.
      tillFetch(`/api/public-stations?companyId=${overrideCompanyId}`)
        .then(r => r.json()).then(d => setStations(d.stations ?? [])).catch(() => {});
      // Fetch staff and shift together via server-side routes (bypass RLS — no auth session).
      Promise.all([
        tillFetch(`/api/public-staff?companyId=${overrideCompanyId}`).then(r => r.json()).catch(() => ({ staff: [] })),
        tillFetch(`/api/public-shift?companyId=${overrideCompanyId}`).then(r => r.json()).catch(() => ({ shift: null })),
      ]).then(([staffData, shiftData]) => {
        setPinStaffList(staffData.staff ?? []);
        setShift(shiftData.shift ?? null);
        setShiftChecked(true);
      });
      tillFetch(`/api/public-modifiers?companyId=${overrideCompanyId}`)
        .then(r => r.json()).then(d => setModifierGroups(d.groups ?? [])).catch(() => {});
      Promise.all([
        tillFetch(`/api/public-menu?companyId=${overrideCompanyId}`).then(r => r.json()).then(d => d.items ?? []).catch(() => []),
        tillFetch(`/api/public-orders?companyId=${overrideCompanyId}&limit=200`).then(r => r.json()).then(d => d.orders ?? []).catch(() => []),
        tillFetch(`/api/public-categories?companyId=${overrideCompanyId}`).then(r => r.json()).then(d => d.categories ?? []).catch(() => []),
        tillFetch(`/api/public-tables?companyId=${overrideCompanyId}`).then(r => r.json()).then(d => ({ tables: normalizeTables(d.tables ?? []), halls: (d.halls ?? []) as Hall[] })).catch(() => ({ tables: [], halls: [] })),
        fetchTablesEnabled(),
        fetchKassaEnabled(),
      ]).then(([m, o, c, tb, te, ke]) => {
        setOnline(true); setMenu(m); setOrders(o); setTables(tb.tables); setHalls(tb.halls); setTablesOn(te); setKassaOn(ke as boolean);
        const available = c.filter((cat: { available: boolean }) => cat.available);
        setAvailableCategories(available);
        const cats = available.filter((a: { name: string }) => m.some((i: { category: string }) => i.category === a.name)).map((a: { name: string }) => a.name);
        if (cats.length > 0) setActiveCategory(cats[0]);
      }).catch(() => setOnline(false));
      return;
    }

    const session = getSession();
    if (!session) { router.replace('/login'); return; }
    // The till is not an employee's screen — send them to their own sex rather than
    // to a login form they are already past.
    if (session.role !== 'seller' && session.role !== 'owner') { router.replace(homeFor(session)); return; }
    validateSession(session).then(valid => {
      if (!valid) { logout(); router.replace('/login'); return; }
      const exp = getSession()?.expiresAt;
      if (exp !== undefined) setExpiresAt(exp);
    });
    // If another tab logs into a different account, this tab's company context
    // no longer matches the shared auth token — force re-login instead of
    // firing doomed cross-company requests.
    const { data: authSub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!s || s.user.id !== session.id) { clearLocalSession(); router.replace('/login'); }
    });
    setCompanyContext(session.companyId);
    setSellerName(session.name);
    fetchCompanySettings(session.companyId ?? '').then(setBizSettings);
    fetchBranding().then(({ logoUrl: l, brandColor: b }) => { setLogoUrl(l); applyBrand(b); });
    Promise.all([fetchOpenShift(), fetchStaff()]).then(([s, st]) => {
      setShift(s); setPinStaffList(st); setShiftChecked(true);
    });
    fetchOrdersCount().then(setTotalOrders);
    fetchStations().then(setStations);
    fetchStationReady().then(setReadyRows);
    fetchModifierGroups().then(setModifierGroups);
    fetchHalls().then(setHalls);
    Promise.all([fetchMenu(), fetchOrders({ limit: 200 }), fetchCategories(), fetchTables(), fetchTablesEnabled(), fetchKassaEnabled(), fetchPrintReceipt()]).then(([m, o, c, tb, te, ke, pr]) => {
      setOnline(true); setMenu(m); setOrders(o); setTables(tb); setTablesOn(te); setKassaOn(ke); setShouldPrintReceipt(pr);
      const available = c.filter(cat => cat.available);
      setAvailableCategories(available);
      const cats = available.filter(a => m.some(i => i.category === a.name)).map(a => a.name);
      if (cats.length > 0) setActiveCategory(cats[0]);
    }).catch(() => setOnline(false));
    return () => authSub.subscription.unsubscribe();
  }, [router, overrideCompanyId, overrideCompanyName, overrideBrandColor, overrideExpiresAt, dataVersion]);

  // ── Kitchen printers ────────────────────────────────────────────────────────
  // Only inside the desktop shell, and only with a real login: claiming tickets
  // goes through RLS. In a browser this is a no-op, so the tablets are unaffected.
  //
  // What decides it is the session on the machine, not the route that drew the
  // page. The register runs the terminal link inside the shell with an owner
  // already signed in, and refusing on the route alone left that session unused —
  // slips piled up in print_jobs with nothing on the network to carry them.
  //
  // A session belonging to another company is the one case to refuse: a terminal
  // link pointed at one restaurant must never drain another's queue.
  useEffect(() => {
    if (!isDesktop()) return;
    const companyId = getSession()?.companyId;
    if (!companyId) return;
    if (overrideCompanyId && overrideCompanyId !== companyId) return;
    return startKitchenPrinting(companyId);
  }, [overrideCompanyId]);

  useEffect(() => {
    if (overrideCompanyId) return;
    async function sync() {
      if (!getSession()) return;
      try {
        const [m, o, c, st, s, mg] = await Promise.all([
          fetchMenu(), fetchOrders({ limit: 200 }), fetchCategories(), fetchStaff(), fetchOpenShift(), fetchModifierGroups(),
        ]);
        setMenu(m); setOrders(o); setShift(s); setModifierGroups(mg);
        setAvailableCategories(c.filter(cat => cat.available));
        setPinStaffList(st);
      } catch { /* ignore focus sync errors */ }
    }
    function onVisible() {
      if (document.visibilityState === 'visible') sync();
    }
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [overrideCompanyId]);

  // Public terminal: the anon supabase client can't receive realtime (no auth session, RLS),
  // so poll the public endpoints on an interval and on tab-focus. This propagates admin-side
  // changes (hidden menu items, deactivated sellers) to an open terminal without a manual refresh.
  // (The wrapper page handles token revalidation / link revocation separately.)
  useEffect(() => {
    if (!overrideCompanyId) return;
    const sync = () => { if (document.visibilityState !== 'hidden') refreshAll({ silent: true }); };
    const id = setInterval(sync, 40000);
    const onVisible = () => { if (document.visibilityState === 'visible') refreshAll({ silent: true }); };
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [overrideCompanyId, refreshAll]);

  // Mobile browsers suspend the realtime socket on lock / app-switch / Wi-Fi↔LTE handoff
  // and it does not reliably re-subscribe, so a phone can sit on a dead channel and silently
  // never see new orders. Track the channel's live status: `realtimeUp` gates the polling
  // fallback below (desktop keeps a healthy socket and never polls), and `rtAttempt` forces
  // a fresh channel when we wake up on a dead one.
  const [realtimeUp, setRealtimeUp] = useState(false);
  const [rtAttempt, setRtAttempt] = useState(0);

  useEffect(() => {
    const channel = supabase
      .channel('seller-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        refreshOrders();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => {
        refreshOrders();
      })
      // A sex finishing its part is the one change the seller doesn't make himself,
      // so it's the one he'd never learn about without this.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_station_ready' }, () => {
        refreshOrders();
      })
      .subscribe(status => setRealtimeUp(status === 'SUBSCRIBED'));
    return () => { setRealtimeUp(false); supabase.removeChannel(channel); };
  }, [refreshOrders, rtAttempt]);

  useEffect(() => {
    if (realtimeUp) return;
    const retry = () => setRtAttempt(a => a + 1);
    const onVisible = () => { if (document.visibilityState === 'visible') retry(); };
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [realtimeUp]);

  // Only runs while the socket is not confirmed subscribed — in practice a phone whose
  // channel died. A missed order is the one failure a POS can't take, so this is the seatbelt.
  // (The public terminal has its own 40s poll and no realtime at all.)
  useEffect(() => {
    if (overrideCompanyId || realtimeUp) return;
    const id = setInterval(() => {
      if (document.visibilityState !== 'hidden') refreshOrders({ silent: true });
    }, 20000);
    return () => clearInterval(id);
  }, [overrideCompanyId, realtimeUp, refreshOrders]);

  useEffect(() => {
    const channel = supabase
      .channel('seller-data')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, () => refreshAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, () => refreshAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurant_tables' }, () => refreshAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'halls' }, () => refreshAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'companies' }, async () => {
        const [te, ke] = await Promise.all([fetchTablesEnabled(), fetchKassaEnabled()]);
        setTablesOn(te); setKassaOn(ke);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [refreshAll]);

  // ── cart helpers ──────────────────────────────────────────────────────────

  // Two cart lines merge only when they are the same product, the same picks AND
  // the same price. Price is in the key because the same label can now cost
  // different amounts — a set re-priced mid-cart must not fold two lines together
  // and charge both at one price.
  function sameCartLine(ci: OrderItem, itemId: string, mods?: string, price?: number): boolean {
    return ci.menuItem.id === itemId
      && (ci.modifiers ?? '') === (mods ?? '')
      && (price === undefined || ci.menuItem.price === price);
  }

  function addToCart(item: MenuItem, mods?: string, variantId?: string, modifiersDetail?: SelectedModifier[]) {
    setCart(prev => {
      const ex = prev.find(ci => sameCartLine(ci, item.id, mods, item.price));
      if (ex) return prev.map(ci =>
        sameCartLine(ci, item.id, mods, item.price) ? { ...ci, quantity: ci.quantity + 1 } : ci
      );
      return [...prev, { menuItem: item, quantity: 1, modifiers: mods, variantId, modifiersDetail }];
    });
  }

  function removeFromCart(itemId: string, mods?: string, price?: number) {
    setCart(prev => {
      const ex = prev.find(ci => sameCartLine(ci, itemId, mods, price));
      if (!ex) return prev;
      if (ex.quantity === 1) return prev.filter(ci => !sameCartLine(ci, itemId, mods, price));
      return prev.map(ci =>
        sameCartLine(ci, itemId, mods, price) ? { ...ci, quantity: ci.quantity - 1 } : ci
      );
    });
  }

  // The reusable sets this item offers, in the order the owner arranged them.
  function groupsForItem(item: MenuItem): ModifierGroup[] {
    const ids = item.modifierGroupIds ?? [];
    if (ids.length === 0) return [];
    return ids
      .map(id => modifierGroups.find(g => g.id === id))
      .filter((g): g is ModifierGroup => !!g && g.options.length > 0);
  }

  function handleMenuItemTap(item: MenuItem) {
    const groups = groupsForItem(item);
    const hasVariants = (item.variants?.length ?? 0) > 0;
    if (hasVariants || groups.length > 0) {
      // Nothing is preselected: with prices in play, a default pick would quietly
      // add money the seller never chose. Required groups are enforced instead.
      setSelectedMods({});
      setSelectedVariant(hasVariants ? { id: item.variants![0].id, name: item.variants![0].name, price: item.variants![0].price } : null);
      setModifierItem(item);
    } else {
      addToCart(item);
    }
  }

  // What the current modal selection comes to. One place computes the price, the
  // label and the snapshot, so what the seller is shown and what is charged can
  // never disagree.
  const modifierDraft = useMemo(() => {
    if (!modifierItem) return null;
    const base = selectedVariant?.price ?? modifierItem.price;
    const detail: SelectedModifier[] = [];
    for (const g of groupsForItem(modifierItem)) {
      for (const optId of selectedMods[g.id] ?? []) {
        const opt = g.options.find(o => o.id === optId);
        if (opt) detail.push({ groupName: g.name, optionName: opt.name, price: opt.price });
      }
    }
    // Two decimals: summing 0.1-style prices in binary floating point otherwise
    // leaves 3.0000000000000004 on the receipt.
    const price = Math.round((base + detail.reduce((s, d) => s + d.price, 0)) * 100) / 100;
    const label = [selectedVariant?.name, ...detail.map(d => d.optionName)].filter(Boolean).join(' · ');
    // A required group with nothing picked blocks the add.
    const missing = groupsForItem(modifierItem).some(g => g.minSelect > 0 && (selectedMods[g.id]?.length ?? 0) === 0);
    return { price, label, detail, missing };
  // groupsForItem reads modifierGroups; both are in the deps below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modifierItem, selectedVariant, selectedMods, modifierGroups]);

  function toggleModOption(group: ModifierGroup, optionId: string) {
    setSelectedMods(prev => {
      const current = prev[group.id] ?? [];
      const isOn = current.includes(optionId);
      // Pick-one replaces; tapping the picked option again clears it, so a
      // non-required group can be left empty on purpose.
      if (group.maxSelect === 1) return { ...prev, [group.id]: isOn ? [] : [optionId] };
      if (isOn) return { ...prev, [group.id]: current.filter(id => id !== optionId) };
      if (group.maxSelect !== null && current.length >= group.maxSelect) return prev;
      return { ...prev, [group.id]: [...current, optionId] };
    });
  }

  function confirmModifiers() {
    if (!modifierItem || !modifierDraft || modifierDraft.missing) return;
    // The folded price rides on menuItem.price — the snapshot every total reads.
    const itemToAdd = { ...modifierItem, price: modifierDraft.price };
    addToCart(
      itemToAdd,
      modifierDraft.label || undefined,
      selectedVariant?.id,
      modifierDraft.detail.length > 0 ? modifierDraft.detail : undefined,
    );
    setModifierItem(null);
    setSelectedVariant(null);
    setSelectedMods({});
  }

  function tableName(id: number | null): string {
    if (!id) return tablesOn ? 'Takeaway' : '';
    return tables.find(t => t.id === id)?.name ?? `Masa ${id}`;
  }

  function hallName(id: string | undefined): string {
    return halls.find(h => h.id === (id ?? halls[0]?.id))?.name ?? '';
  }

  // Tables predating halls have no hall_id; they belong to the first hall so the
  // floor plan never hides a table the seller can still be handed an order for.
  const firstHallId = halls[0]?.id ?? null;
  const hallTables = useMemo(
    () => tables.filter(t => (t.hallId ?? firstHallId) === activeHallId),
    [tables, activeHallId, firstHallId],
  );

  useEffect(() => {
    if (halls.length === 0) { setActiveHallId(null); return; }
    setActiveHallId(prev => (prev && halls.some(h => h.id === prev) ? prev : halls[0].id));
  }, [halls]);

  function handleNav(id: View) {
    if (id === 'kassa' && !kassaOn) return;
    setAppendOrderId(null);
    if (id === 'new-order') {
      if (!tablesOn) { startNewOrder('takeaway'); return; }
      setOrderType(null); setCart([]);
    }
    setView(id);
  }

  function startNewOrder(type: OrderType, tableNum?: number) {
    setAppendOrderId(null);
    setOrderType(type);
    setSelectedTable(tableNum ?? null);
    setCart([]);
    setNote('');
    setMenuSearch('');
    const cats = availableCategories.filter(a => menu.some(i => i.category === a.name)).map(a => a.name);
    if (cats.length > 0) setActiveCategory(cats[0]);
    setView('menu');
  }

  // Open the menu in "append to existing order" mode (reuses the same cart UI).
  function startAppend(order: Order) {
    setAppendOrderId(order.id);
    setCart([]);
    setNote(order.note ?? '');
    setMenuSearch('');
    const cats = availableCategories.filter(a => menu.some(i => i.category === a.name)).map(a => a.name);
    if (cats.length > 0) setActiveCategory(cats[0]);
    setView('menu');
  }

  function cancelAppend() {
    setAppendOrderId(null);
    setCart([]);
    setMenuSearch('');
    setView('orders');
  }

  async function submitAppend() {
    if (cart.length === 0 || submitting || !appendOrderId) return;
    const orderId = appendOrderId;
    const newItems = cart;
    const newNote = note.trim();
    setSubmitting(true);
    const saveError = overrideCompanyId
      ? (await postOrQueue(
          // A fresh key per append: the same dish added twice to one order is two
          // legitimate writes, not a retry.
          `append:${crypto.randomUUID()}`,
          '/api/add-order-items',
          { orderId, items: newItems, companyId: overrideCompanyId, note: newNote, token: overrideToken },
          overrideCompanyId,
        )).ok ? null : 'failed'
      : await addItemsToOrder(orderId, newItems, newNote);
    setSubmitting(false);
    if (saveError) {
      const reason = /fetch|network|failed to fetch|load failed|failed/i.test(saveError)
        ? 'İnternet bağlantısı yoxdur.'
        : /closed|409/i.test(saveError)
        ? 'Sifariş artıq bağlanıb.'
        : saveError;
      alert(`Məhsullar əlavə edilmədi.\n\nSəbəb: ${reason}\n\nYenidən cəhd edin.`);
      return;
    }
    // Optimistically merge the new items into the order (status stays the same).
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, items: [...o.items, ...newItems], note: newNote || undefined } : o));
    setExpandedOrderId(orderId);
    setAppendOrderId(null);
    setCart([]); setNote(''); setMenuSearch('');
    setMobileCartOpen(false);
    setView('orders');
  }

  // Reduce an existing line's quantity by one (from the "Əlavə et" edit screen). When it drops to
  // zero the whole line goes. Either way it is a SOFT delete: the row survives, struck through on
  // the card, and is what the kitchen's LEGV slip prints. No stock impact — apply_stock_on_payment()
  // skips removed rows, so the warehouse never drains for a dish that wasn't made. A brief toast
  // confirms the change reached the server.
  async function handleDecrementItem(order: Order, oi: OrderItem) {
    if (!oi.id || !isOrderOpen(order)) return;
    // Already cooked: taking it off now bins real food, and somebody pays for it. Not
    // blocked — the guest may genuinely have changed their mind — but not a silent tap
    // either. Who did it is already on the record (removed_by, removed_at).
    if (isItemReady(order, oi) && !confirm(`"${oi.menuItem.name}" hazırdır. Yenə də silinsin?`)) return;
    const newQty = oi.quantity - 1;
    const ok = overrideCompanyId
      ? (await postOrQueue(
          // Keyed by the quantity it lands on, so two taps of "−" queue as two
          // distinct steps while a retry of either stays one.
          `qty:${oi.id}:${newQty}`,
          '/api/update-order-item-qty',
          { orderItemId: oi.id, orderId: order.id, quantity: newQty, companyId: overrideCompanyId, token: overrideToken, removedBy: effectiveSeller },
          overrideCompanyId,
        )).ok
      // The order id is only needed by the desktop till, which stores an order
      // whole and has no other way to find the line.
      : await setOrderItemQuantity(oi.id, newQty, effectiveSeller, order.id);
    if (!ok) { alert('Dəyişdirilmədi. Yenidən cəhd edin.'); return; }

    // Optimistically apply, then reconcile with the server. The removed line must move
    // into removedItems, not vanish: dropping it would make it flicker off the card and
    // back on at the next refresh.
    const now = new Date().toISOString();
    setOrders(prev => prev.map(o => {
      if (o.id !== order.id) return o;
      const full = newQty <= 0;
      const ghost: OrderItem = {
        ...oi,
        id: full ? oi.id : `pending-${oi.id}`,   // a partial removal's ghost is a separate server row
        quantity: full ? oi.quantity : 1,        // …carrying only the unit that was taken away
        // A fully-removed line keeps its original timestamp and stays in the batch it
        // was ordered in; a partial removal's ghost belongs to the moment it happened.
        createdAt: full ? oi.createdAt : now,
        removedAt: now,
        removedBy: effectiveSeller,
      };
      return {
        ...o,
        items: newQty <= 0
          ? o.items.filter(x => x.id !== oi.id)
          : o.items.map(x => x.id === oi.id ? { ...x, quantity: newQty } : x),
        removedItems: [...(o.removedItems ?? []), ghost],
      };
    }));
    flashSaved();
    refreshOrders();
  }

  async function submitOrder() {
    if (appendOrderId) { submitAppend(); return; }
    if (cart.length === 0 || submitting) return;
    if (orderType === 'masa' && !selectedTable) return;
    setSubmitting(true);
    const order: Order = {
      id: crypto.randomUUID(),
      // A guess, from the orders this screen happens to be holding — the web
      // till's optimistic number, replaced by the server's on the next read.
      // The desktop till sends 0 instead and lets its own database number the
      // order: that number is the one that gets printed, so it must come from
      // the whole local table rather than from whatever is on screen.
      orderNumber: hasLocalDb() ? 0 : (orders[0]?.orderNumber ?? 0) + 1,
      tableNumber: orderType === 'takeaway' ? 0 : selectedTable!,
      items: cart,
      status: 'gözləyir',
      createdAt: new Date().toISOString(),
      sellerName: effectiveSeller,
      staffId: activeStaff?.id,
      note: note.trim() || undefined,
    };
    // Offline the insert cannot go now, but the order still exists: it goes into
    // the queue under its own id, the kitchen ticket still prints over the LAN,
    // and the real order_number arrives when the line does.
    //
    // On the desktop till the question does not arise — addOrder writes to the
    // machine's own database and returns before a network could have answered —
    // so isOnline() is asked only where there is nowhere else for the order to
    // go. Asking it anyway would send a perfectly-saveable order to IndexedDB
    // whenever the probe happened to be mid-flight.
    const saveError = hasLocalDb() || isOnline()
      ? await addOrder(order)
      : (await enqueue(`order:${order.id}`, ADD_ORDER, order, overrideCompanyId ?? null), null);
    setSubmitting(false);
    if (saveError) {
      const reason = /fetch|network|failed to fetch|load failed/i.test(saveError)
        ? 'İnternet bağlantısı yoxdur.'
        : /jwt|auth/i.test(saveError)
        ? 'Sessiya başa çatıb, səhifəni yeniləyin.'
        : /policy|permission/i.test(saveError)
        ? 'İcazə xətası.'
        : saveError;
      alert(`Sifariş yadda saxlanılmadı.\n\nSəbəb: ${reason}\n\nYenidən cəhd edin.`);
      return;
    }
    setOrders(prev => [order, ...prev]);
    setCart([]); setNote(''); setSelectedTable(null); setOrderType(null);
    setMobileCartOpen(false);
    setView('orders');
    // No payment sheet here on purpose. It used to open the moment the order was
    // placed, pre-filled with the full amount as cash, so one stray tap on
    // "Ödənildi ✓" closed an order nobody had paid for yet. Payment is now always
    // deliberate: the waiter opens it from the order card's Ödəniş button when the
    // money is actually in hand.
  }

  // The bill the waiter takes to the table, printed on demand from the still-open
  // order. Nothing is written to the DB: this is a piece of paper, not a state
  // change, so it can be printed as many times as the table asks for it.
  //
  // Pairing happens here rather than sending the cashier to the admin panel. Only
  // admin has "Yazıcı seç", and a waiter who has never opened admin would press
  // this button and get silence — so an unpaired printer asks to be picked, once,
  // on the click that needs it.
  async function handlePrintBill(order: Order) {
    if (printBillBusy) return;
    setPrintBillBusy(order.id);
    try {
      let ready = printerConnected;
      if (!ready) {
        ready = await selectPrinter();
        setPrinterConnected(ready);
        // Cancelling the browser's device picker is a decision, not a fault —
        // the waiter closed it on purpose and doesn't need an alert about it.
        if (!ready) return;
      }
      const ok = await printBill(order, overrideCompanyName || getSession()?.companyName || '', logoUrl);
      if (!ok) {
        setPrinterConnected(false);
        alert('Hesab çap olunmadı — yazıcı bağlantısını yoxlayın.');
      }
    } finally {
      setPrintBillBusy(null);
    }
  }

  // The same paper the customer got when they paid, printed again from Tarixçə —
  // for the receipt that jammed, tore, or was thrown away before anyone read it.
  // Like the bill, this writes nothing: the order was closed once and stays closed,
  // so the second copy is identical to the first rather than a fresh event.
  async function handleReprintReceipt(order: Order) {
    if (printBillBusy) return;
    setPrintBillBusy(order.id);
    try {
      let ready = printerConnected;
      if (!ready) {
        ready = await selectPrinter();
        setPrinterConnected(ready);
        if (!ready) return;
      }
      const ok = await printReceipt(order, overrideCompanyName || getSession()?.companyName || '', logoUrl);
      if (!ok) {
        setPrinterConnected(false);
        alert('Qəbz çap olunmadı — yazıcı bağlantısını yoxlayın.');
      }
    } finally {
      setPrintBillBusy(null);
    }
  }

  // Pre-fill cash with the total — the common case is exact cash payment;
  // the field selects on focus so a different amount can be typed straight over it.
  function openPayment(order: Order) {
    setPayingOrder(order);
    setCashInput(orderTotal(order).toFixed(2));
    setCardInput('');
    setDiscountInput('');
    setDiscountType('₼');
  }

  function calcDiscount(fullTotal: number): number {
    const raw = parseFloat(discountInput) || 0;
    if (discountType === '%') return Math.min(fullTotal, (fullTotal * raw) / 100);
    return Math.min(fullTotal, raw);
  }

  async function confirmPayment() {
    if (!payingOrder) return;
    const order = payingOrder;
    const cash = parseFloat(cashInput) || 0;
    const card = parseFloat(cardInput) || 0;
    const fullTotal = orderTotal(order);
    const discountAmt = calcDiscount(fullTotal);
    const total = fullTotal - discountAmt;
    const overpay = Math.max(0, cash + card - total);
    const change = Math.min(overpay, cash);
    const cashKept = cash - change;
    setPayingOrder(null);
    // The DB update is conditional — a no-op if someone else already paid this order
    // One key per order: whether this payment goes now or waits in the queue,
    // the server applies it exactly once.
    const paid = overrideCompanyId
      ? (await postOrQueue(
          `pay:${order.id}`,
          '/api/update-order-status',
          { orderId: order.id, status: 'ödənilib', cashAmount: cashKept, cardAmount: card, changeAmount: change, discountAmount: discountAmt || undefined, discountType: discountAmt ? discountType : undefined, companyId: overrideCompanyId, token: overrideToken },
          overrideCompanyId,
        )).ok
      : await updateOrderStatus(order.id, 'ödənilib', cashKept, card, change, discountAmt || undefined, discountAmt ? discountType : undefined);
    if (paid) {
      // paidAt mirrors what the DB just wrote, so the history shows a closing time
      // straight away instead of a dash until the next fetch
      const paidOrder = { ...order, status: 'ödənilib' as const, paidAt: new Date().toISOString(), cashAmount: cashKept, cardAmount: card, changeAmount: change, discountAmount: discountAmt || undefined, discountType: discountAmt ? discountType : undefined };
      setOrders(prev => prev.map(o => o.id === order.id ? paidOrder : o));
      if (printerConnected) {
        // The public terminal link has no session, so the name has to come off
        // the props there or the receipt prints with a blank header.
        const cName = overrideCompanyName || getSession()?.companyName || '';
        if (shouldPrintReceipt) printReceipt(paidOrder, cName, logoUrl);
        // Every closed bill, not just the ones that put notes in the till: a card
        // payment still needs the drawer for change owed from an earlier round,
        // and a cashier who has to open it by key stops trusting the button.
        openCashDrawer();
      }
    } else {
      refreshOrders();
    }
  }

  function openCancel(order: Order) {
    setCancellingOrder(order);
    setCancelReason(null);
    setCancelOtherText('');
  }

  async function confirmCancel() {
    if (!cancellingOrder || !cancelReason || cancelBusy) return;
    const cancelling = cancellingOrder;
    const reason = cancelReason === 'Digər' ? cancelOtherText.trim() : cancelReason;
    if (!reason) return;
    setCancelBusy(true);
    // Conditional in the DB — a no-op if the order got paid in the meantime
    const ok = overrideCompanyId
      ? (await postOrQueue(
          `cancel:${cancelling.id}`,
          '/api/cancel-order',
          { orderId: cancelling.id, reason, by: effectiveSeller, companyId: overrideCompanyId, token: overrideToken },
          overrideCompanyId,
        )).ok
      : await cancelOrder(cancelling.id, reason, effectiveSeller);
    setCancelBusy(false);
    setCancellingOrder(null);
    if (ok) {
      setOrders(prev => prev.map(o => o.id === cancelling.id
        ? { ...o, status: 'ləğv edildi' as OrderStatus, cancelReason: reason, cancelledBy: effectiveSeller, cancelledAt: new Date().toISOString() }
        : o));
    } else {
      refreshOrders();
    }
  }

  function openMove(order: Order) {
    setMovingOrder(order);
    setMoveTarget(null);
  }

  async function confirmMove() {
    if (!movingOrder || !moveTarget || moveBusy) return;
    const moving = movingOrder;
    const target = moveTarget;
    setMoveBusy(true);
    // Conditional in the DB — a no-op if the order got paid or closed meanwhile
    const ok = overrideCompanyId
      ? (await postOrQueue(
          // The target is in the key: moving a party twice while offline is two
          // separate writes, and both must land in the order they were made.
          `move:${moving.id}:${target}`,
          '/api/move-table',
          { orderId: moving.id, tableId: target, companyId: overrideCompanyId, token: overrideToken },
          overrideCompanyId,
        )).ok
      : await moveOrderTable(moving.id, target);
    setMoveBusy(false);
    setMovingOrder(null);
    if (ok) {
      setOrders(prev => prev.map(o => o.id === moving.id ? { ...o, tableNumber: target } : o));
    } else {
      refreshOrders();
    }
  }

  // ── kassa (cash shift) ────────────────────────────────────────────────────

  const movementsTotal = (s: CashShift) => s.movements.reduce((t, m) => t + m.amount, 0);
  const expectedCash = shift ? shift.openingCash + shiftSales.cash + movementsTotal(shift) : 0;

  useEffect(() => {
    if (view === 'kassa' && shift) {
      if (overrideCompanyId) {
        tillFetch(`/api/public-shift-sales?companyId=${overrideCompanyId}&openedAt=${encodeURIComponent(shift.openedAt)}`)
          .then(r => r.json()).then(setShiftSales).catch(() => {});
      } else {
        fetchShiftSales(shift.openedAt).then(setShiftSales);
      }
    }
  }, [view, shift, overrideCompanyId]);

  // Detect when admin closes the shift externally
  useEffect(() => {
    const id = setInterval(async () => {
      const open = overrideCompanyId
        ? await tillFetch(`/api/public-shift?companyId=${overrideCompanyId}`).then(r => r.json()).then(d => d.shift ?? null).catch(() => undefined)
        : await fetchOpenShift();
      if (open === null && shift) { setShift(null); setView('orders'); }
    }, 30_000);
    return () => clearInterval(id);
  }, [shift, overrideCompanyId]);

  useEffect(() => {
    if (view !== 'history' || !bizSettings.timezone) return;
    const todayStr = businessToday(bizSettings);
    const from = businessDayStartUtc(todayStr, bizSettings).toISOString();
    const to = new Date().toISOString();
    setHistoryLoading(true);
    const load = overrideCompanyId
      ? tillFetch(`/api/public-orders?companyId=${overrideCompanyId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=500`)
          .then(r => r.json()).then(d => d.orders ?? []).catch(() => [])
      : fetchOrders({ from, to, limit: 500 });
    load.then(setHistoryOrders).finally(() => setHistoryLoading(false));
  }, [view, bizSettings, overrideCompanyId]);

  async function handleOpenShift() {
    const cash = parseFloat(openCashInput) || 0;
    setShiftBusy(true);
    let s = null;
    if (overrideCompanyId) {
      // The till chooses the id and the opening time, so a shift can be opened
      // with no line at all: cash movements and receipts reference this id
      // straight away, and the insert carrying it is replayed later.
      const shiftId = crypto.randomUUID();
      const openedAt = new Date().toISOString();
      const body = { companyId: overrideCompanyId, openingCash: cash, openedBy: effectiveSeller, token: overrideToken, shiftId, openedAt };

      if (hasLocalDb()) {
        // The machine is the authority here: the shift opens on the disk and
        // the insert follows. Nothing to wait for, and nothing to lose if the
        // line never comes back before the drawer does.
        const res = await postOrQueue(`shift:${shiftId}`, '/api/open-shift', body, overrideCompanyId);
        if (res.ok) s = { id: shiftId, openedAt, openedBy: effectiveSeller, openingCash: cash, movements: [], edits: [] };
      } else if (isOnline()) {
        const d = await fetch('/api/open-shift', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `shift:${shiftId}` },
          body: JSON.stringify(body),
        }).then(r => r.json()).catch(() => ({ shift: null }));
        if (d.shift) s = { id: d.shift.id, openedAt: d.shift.opened_at, openedBy: d.shift.opened_by, openingCash: Number(d.shift.opening_cash), closedAt: d.shift.closed_at ?? undefined, movements: Array.isArray(d.shift.movements) ? d.shift.movements : [], edits: [] };
      } else {
        await enqueue(`shift:${shiftId}`, '/api/open-shift', body, overrideCompanyId);
        s = { id: shiftId, openedAt, openedBy: effectiveSeller, openingCash: cash, movements: [], edits: [] };
      }
    } else {
      s = await openShift(cash, effectiveSeller);
    }
    setShiftBusy(false);
    if (s) { setShift(s); setOpenCashInput(''); setJustClosed(false); }
  }

  async function handleAddMovement() {
    if (!shift) return;
    const raw = parseFloat(movAmount) || 0;
    if (raw <= 0 || !movReason.trim()) return;
    // The id is what lets an admin correct this entry later — generate it here so
    // the optimistic row and the stored one are the same movement.
    const mv: ShiftMovement = { id: crypto.randomUUID(), at: new Date().toISOString(), amount: movOut ? -raw : raw, reason: movReason.trim(), by: effectiveSeller };
    const prevShift = shift;
    setShift({ ...shift, movements: [...shift.movements, mv] });
    setShowMovForm(false); setMovAmount(''); setMovReason('');
    try {
      if (overrideCompanyId) {
        // The movement already carries the id an admin uses to correct it later,
        // which makes it exactly the right idempotency key.
        const res = await postOrQueue(
          `movement:${mv.id}`,
          '/api/add-shift-movement',
          { shiftId: shift.id, movement: mv, companyId: overrideCompanyId, token: overrideToken },
          overrideCompanyId,
        );
        if (!res.ok) throw new Error('failed');
      } else {
        await addShiftMovement(shift.id, mv);
      }
    } catch {
      setShift(prevShift);
      alert('Hərəkət yadda saxlanılmadı. Yenidən cəhd edin.');
    }
  }

  async function handleCloseShift() {
    if (!shift || countedInput === '') return;

    // The one thing the till must not do offline. Closing reconciles the drawer
    // against the day's sales, and those come from the server — offline that
    // request fails and the sales read as zero, so the shift would be recorded
    // as short by exactly a full day's takings. The same applies while writes
    // are still queued: the sales figure would be missing whatever has not
    // landed yet. Better to make them wait than to write a false record.
    if (!online || pendingCount > 0) {
      alert(
        !online
          ? 'İnternet yoxdur — növbəni bağlamaq olmaz.\n\nBağlantı bərpa olunanda yenidən cəhd edin.'
          : `Hələ ${pendingCount} əməliyyat serverə göndərilməyib.\n\nGözləyin, sonra növbəni bağlayın.`,
      );
      return;
    }

    const counted = parseFloat(countedInput) || 0;
    const countedCard = terminalInput === '' ? undefined : parseFloat(terminalInput) || 0;
    setShiftBusy(true);
    // re-fetch shift + sales right before closing so movements added elsewhere
    // and last-second payments are all in the snapshot
    const fresh = overrideCompanyId
      ? await tillFetch(`/api/public-shift?companyId=${overrideCompanyId}`).then(r => r.json()).then(d => d.shift ?? shift).catch(() => shift)
      : (await fetchOpenShift()) ?? shift;
    const sales = overrideCompanyId
      ? await tillFetch(`/api/public-shift-sales?companyId=${overrideCompanyId}&openedAt=${encodeURIComponent(fresh.openedAt)}`).then(r => r.json()).catch(() => ({ cash: 0, card: 0 }))
      : await fetchShiftSales(fresh.openedAt);
    const expected = fresh.openingCash + sales.cash + movementsTotal(fresh);
    if (overrideCompanyId) {
      const closeBody = { shiftId: fresh.id, expectedCash: expected, countedCash: counted, closedBy: effectiveSeller, cardSales: sales.card, countedCard, companyId: overrideCompanyId, token: overrideToken };
      // Local-first on the desktop, so the till's own shift closes with the same
      // figures it just sent rather than reading open until the next pull. The
      // guard above already proved the line is up and the outbox empty.
      await postOrQueue(`close:${fresh.id}`, '/api/close-shift', closeBody, overrideCompanyId);
    } else {
      await closeShift(fresh.id, expected, counted, effectiveSeller, sales.card, countedCard);
    }
    setShiftBusy(false);
    setShift(null); setCountedInput(''); setTerminalInput(''); setView('orders');
    setJustClosed(true);
  }

  async function loadMoreOrders() {
    setLoadingMore(true);
    try {
      const more = overrideCompanyId
        ? await tillFetch(`/api/public-orders?companyId=${overrideCompanyId}&limit=200&offset=${orders.length}`).then(r => r.json()).then(d => d.orders ?? []).catch(() => [])
        : await fetchOrders({ limit: 200, offset: orders.length });
      setOrders(prev => [...prev, ...more.filter((m: { id: string }) => !prev.some(p => p.id === m.id))]);
    } finally { setLoadingMore(false); }
  }

  async function handleStatusChange(id: string, status: OrderStatus) {
    const prevStatus = orders.find(o => o.id === id)?.status;
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status } : o));
    const ok = overrideCompanyId
      ? (await postOrQueue(
          `status:${id}:${status}`,
          '/api/update-order-status',
          { orderId: id, status, companyId: overrideCompanyId, token: overrideToken },
          overrideCompanyId,
        )).ok
      : await updateOrderStatus(id, status);
    if (!ok && prevStatus) {
      setOrders(prev => prev.map(o => o.id === id ? { ...o, status: prevStatus } : o));
    }
  }

  const cartTotal   = cart.reduce((s, ci) => s + ci.menuItem.price * ci.quantity, 0);
  const cartCount   = cart.reduce((s, ci) => s + ci.quantity, 0);
  const appendOrder = appendOrderId ? orders.find(o => o.id === appendOrderId) ?? null : null;
  // Category tab order follows the admin's saved category order
  const categories  = [...new Set(availableCategories.filter(a => menu.some(i => i.category === a.name)).map(a => a.name))];
  const menuQuery   = azNormalize(menuSearch.trim());
  const filtered    = menuQuery
    ? menu.filter(m => m.available && azNormalize(m.name).includes(menuQuery))
    : menu.filter(m => m.category === activeCategory && m.available);
  const active      = orders.filter(isOrderOpen);
  const bizToday    = businessToday(bizSettings);
  const isToday     = (iso: string) => businessDay(iso, bizSettings) === bizToday;
  const todayOrders = active.filter(o => isToday(o.createdAt));
  const prevOrders  = active.filter(o => !isToday(o.createdAt));

  // ── Which sexes have finished ───────────────────────────────────────────────
  // The only signal on this screen: green means the food is on the counter. A line
  // is green when the sex that makes it has said so.
  const menuById = useMemo(() => menuIndex(menu), [menu]);
  // readyStationIds, not the raw rows: a sex that said "done" before the waiter added
  // one more beer is not done any more, and the beer must not read as ready.
  const readyByOrder = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const o of active) m.set(o.id, readyStationIds(o, readyRows, menuById, stations));
    return m;
  }, [active, readyRows, menuById, stations]);

  // "3/10 hazır" counts LINES, not sexes: the waiter is carrying plates, and a sex
  // with one beer and a sex with nine kebabs are not half the order each.
  const readyProgress = useCallback((o: Order): { done: number; total: number } => {
    const ready = readyByOrder.get(o.id);
    if (!ready || ready.size === 0) return { done: 0, total: o.items.length };
    let done = 0;
    for (const item of o.items) {
      const sid = stationForItem(item, menuById, stations);
      if (sid && ready.has(sid)) done++;
    }
    return { done, total: o.items.length };
  }, [readyByOrder, menuById, stations]);

  const isItemReady = useCallback((o: Order, item: OrderItem): boolean => {
    const ready = readyByOrder.get(o.id);
    if (!ready) return false;
    const sid = stationForItem(item, menuById, stations);
    return !!sid && ready.has(sid);
  }, [readyByOrder, menuById, stations]);

  const historyQuery = historySearch.trim().toLowerCase();
  const filteredHistoryOrders = historyQuery
    ? historyOrders.filter(o =>
        orderSearchText(o).includes(historyQuery) ||
        (o.sellerName ?? '').toLowerCase().includes(historyQuery) ||
        tableName(o.tableNumber).toLowerCase().includes(historyQuery))
    : historyOrders;
  const paidHistoryOrders = historyOrders.filter(o => o.status === 'ödənilib');
  const { historyNagd, historyKart } = paidHistoryOrders.reduce((acc, o) => {
    const t = orderTotal(o);
    const cardPart = Math.min(o.cardAmount ?? 0, t);
    acc.historyKart += cardPart;
    acc.historyNagd += Math.min(o.cashAmount ?? 0, t - cardPart);
    return acc;
  }, { historyNagd: 0, historyKart: 0 });
  const historyRevenue = paidHistoryOrders.reduce((s, o) => s + orderTotal(o), 0);

  // ── sidebar (desktop only) ────────────────────────────────────────────────

  function SidebarContent() {
    return (
      <div className="flex flex-col h-full bg-white">
        <div className={`flex items-center h-14 border-b border-stone-100/50 ${collapsed ? 'justify-center px-2' : 'justify-between px-4'}`}>
          {!collapsed && (
            <span className="font-semibold text-stone-800 text-sm truncate max-w-[180px]">{overrideCompanyName || getSession()?.companyName || 'Satıcı Paneli'}</span>
          )}
          <button
            onClick={() => setCollapsed(c => !c)}
            className="w-8 h-8 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-700 transition-colors flex"
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        <nav className={`flex flex-col gap-1 p-3 flex-1 ${collapsed ? 'items-center' : ''}`}>
          {[
            { id: 'orders' as View,    label: 'Sifarişlər',   icon: Receipt },
            { id: 'new-order' as View, label: 'Yeni sifariş', icon: ShoppingBag },
            ...(kassaOn ? [{ id: 'kassa' as View, label: 'Kassa', icon: Wallet }] : []),
            { id: 'history' as View,   label: 'Tarixçə',      icon: History },
          ].map(n => {
            const Icon = n.icon;
            const isActive = view === n.id || (n.id === 'new-order' && view === 'menu');
            const badge = n.id === 'orders' && active.length > 0 ? active.length : null;

            if (collapsed) {
              return (
                <button
                  key={n.id}
                  title={n.label}
                  onClick={() => handleNav(n.id)}
                  className={`relative flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${isActive ? 'bg-primary-100 text-primary-800' : 'text-stone-500 hover:bg-stone-100 hover:text-stone-700'}`}
                >
                  <Icon className="w-4 h-4" />
                  {badge && <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary-800 text-white text-[9px] rounded-full flex items-center justify-center font-bold">{badge}</span>}
                </button>
              );
            }

            return (
              <button
                key={n.id}
                onClick={() => handleNav(n.id)}
                className={`flex items-center gap-3 h-9 px-3 rounded-lg text-sm font-medium transition-colors w-full ${isActive ? 'bg-primary-800 text-white shadow-sm' : 'text-stone-600 hover:bg-primary-50 hover:text-primary-900'}`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex-1 text-left truncate">{n.label}</span>
                {badge && (
                  <span className={`text-xs rounded-full px-1.5 py-0.5 font-semibold ${isActive ? 'bg-white/20 text-white' : 'bg-primary-800 text-white'}`}>
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {!collapsed ? (
          <div className="px-4 py-4 border-t border-stone-100/50">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center text-primary-900 text-xs font-bold">
                {effectiveSeller[0]?.toUpperCase()}
              </div>
              <span className="text-xs text-stone-600 truncate">{effectiveSeller}</span>
              {/* Offline is not an error here — the till keeps working. What the
                  waiter needs to know is how much has not reached the server yet,
                  because that is what is lost if this machine dies. */}
              <div className="ml-auto">
                <SyncStatus online={online} pending={pendingCount} sending={sending} />
              </div>
            </div>
            {!overrideCompanyId && (
              <button onClick={() => { forgetPins(); logout(); router.push("/login"); }} className="flex items-center gap-2 text-xs text-stone-500 hover:text-red-500 transition-colors">
                <LogOut className="w-3.5 h-3.5" /> Çıxış
              </button>
            )}
          </div>
        ) : (
          <div className="py-4 flex flex-col items-center gap-2 border-t border-stone-100/50">
            <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center text-primary-900 text-xs font-bold">
              {effectiveSeller[0]?.toUpperCase()}
            </div>
            <SyncStatus online={online} pending={pendingCount} sending={sending} compact />
            {!overrideCompanyId && (
              <button onClick={() => { forgetPins(); logout(); router.push("/login"); }} title="Çıxış" className="text-stone-500 hover:text-red-500 transition-colors">
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── render ────────────────────────────────────────────────────────────────

  // A freshly installed desktop till has an empty database. Fill it before
  // anything else: every screen below reads the local copy, and they would each
  // render an empty version of themselves — no menu, no room, no staff, which
  // also means no PIN pad and no way in.
  if (needsSetup && setupCompanyId) {
    return (
      <TillSetup
        companyId={setupCompanyId}
        onDone={() => { setNeedsSetup(false); setDataVersion(v => v + 1); }}
      />
    );
  }

  // No taking money without an open shift: until one exists, the only screen
  // a seller can see is the open-shift form.
  if (pinLocked) {
    return (
      <div className="min-h-screen bg-[#f7f3ed] flex flex-col items-center justify-center p-6">
        <div className="w-12 h-12 rounded-2xl bg-primary-800 flex items-center justify-center mb-4">
          <Coffee className="w-6 h-6 text-white" />
        </div>
        <h2 className="font-bold text-xl text-stone-800">{overrideCompanyName || getSession()?.companyName || 'Satıcı Paneli'}</h2>
        <p className="text-sm text-stone-500 mt-1 mb-6">PIN kodunuzu daxil edin</p>

        <div className="flex gap-3 mb-3 h-4 items-center">
          {[0, 1, 2, 3].map(i => (
            <span key={i} className={`rounded-full transition-all ${i < pinInput.length ? 'w-3.5 h-3.5 bg-primary-800' : 'w-3 h-3 bg-stone-300'}`} />
          ))}
        </div>
        <p className={`text-sm h-5 mb-4 ${pinMsg ? 'text-red-500' : 'text-transparent'}`}>{pinMsg || '·'}</p>

        <div className="grid grid-cols-3 gap-3">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
            <button key={d} onClick={() => pressPin(d)} disabled={pinBusy}
              className="w-[4.5rem] h-[4.5rem] sm:w-20 sm:h-20 rounded-2xl bg-white border border-stone-200 text-2xl font-semibold text-stone-700 hover:bg-stone-50 active:scale-95 transition-all disabled:opacity-50">
              {d}
            </button>
          ))}
          <span />
          <button onClick={() => pressPin('0')} disabled={pinBusy}
            className="w-[4.5rem] h-[4.5rem] sm:w-20 sm:h-20 rounded-2xl bg-white border border-stone-200 text-2xl font-semibold text-stone-700 hover:bg-stone-50 active:scale-95 transition-all disabled:opacity-50">
            0
          </button>
          <button onClick={() => setPinInput(p => p.slice(0, -1))} disabled={pinBusy || pinInput.length === 0}
            className="w-[4.5rem] h-[4.5rem] sm:w-20 sm:h-20 rounded-2xl flex items-center justify-center text-stone-500 hover:bg-stone-200/50 active:scale-95 transition-all disabled:opacity-30">
            {pinBusy
              ? <span className="w-5 h-5 border-2 border-stone-300 border-t-primary-800 rounded-full animate-spin" />
              : <Delete className="w-6 h-6" />}
          </button>
        </div>

        {!overrideCompanyId && (
          <button onClick={() => setLogoutConfirm(true)} className="mt-8 flex items-center gap-2 text-xs text-stone-400 hover:text-red-500 transition-colors">
            <LogOut className="w-3.5 h-3.5" /> Terminaldan çıxış
          </button>
        )}
        {logoutConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4">
            <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-xs text-center">
              <p className="font-semibold text-stone-800 mb-1">Terminaldan çıxmaq istəyirsiniz?</p>
              <p className="text-sm text-stone-500 mb-5">Hesabdan tam çıxış olacaq. Davam etmək üçün sahibkarın yenidən daxil olması tələb olunacaq.</p>
              <div className="flex gap-3">
                <button onClick={() => setLogoutConfirm(false)} className="flex-1 py-2.5 rounded-xl border border-stone-200 text-sm font-semibold text-stone-600 hover:bg-stone-50 transition-colors">Ləğv et</button>
                <button onClick={() => { forgetPins(); logout(); router.push("/login"); }} className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition-colors">Çıxış</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!shiftChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f7f3ed]">
        <span className="w-8 h-8 border-2 border-stone-200 border-t-primary-800 rounded-full animate-spin" />
      </div>
    );
  }

  if (!shift && kassaOn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f7f3ed] px-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="w-12 h-12 rounded-2xl bg-primary-800 flex items-center justify-center mx-auto mb-3">
              <Wallet className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-bold text-stone-800">{justClosed ? 'Növbə bağlandı ✓' : 'Növbəni aç'}</h1>
            <p className="text-stone-600 text-sm mt-1">
              {justClosed ? 'Yeni növbə açmaq üçün başlanğıc məbləği daxil et' : 'İşə başlamaq üçün kassadakı məbləği daxil et'}
            </p>
          </div>
          <label className="block text-sm font-medium text-stone-700 mb-1.5">Kassada başlanğıc məbləğ (₼)</label>
          <input
            type="number" min="0" step="0.01" placeholder="0.00"
            value={openCashInput}
            onChange={e => setOpenCashInput(e.target.value)}
            className="w-full border border-stone-200 rounded-xl px-4 py-3 text-base font-semibold text-center focus:outline-none focus:ring-2 focus:ring-primary-700 mb-4"
            autoFocus
          />
          <button
            onClick={handleOpenShift}
            disabled={shiftBusy || openCashInput === ''}
            className="w-full bg-primary-800 hover:bg-primary-900 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {shiftBusy && <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
            Növbəni aç
          </button>
          {!overrideCompanyId && (
            <button
              onClick={() => { forgetPins(); logout(); router.push("/login"); }}
              className="w-full mt-3 text-sm text-stone-500 hover:text-red-500 transition-colors flex items-center justify-center gap-1.5"
            >
              <LogOut className="w-3.5 h-3.5" /> Çıxış
            </button>
          )}
        </div>
      </div>
    );
  }

  function onTouchStart(e: React.TouchEvent) {
    touchStartY.current = e.touches[0].clientY;
  }
  function onTouchMove(e: React.TouchEvent) {
    if (touchStartY.current === null) return;
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta > 5) setPullDistance(Math.min(delta * 0.5, PULL_THRESHOLD));
    else setPullDistance(0);
  }
  function onTouchEnd() {
    if (pullDistance >= PULL_THRESHOLD && !pullRefreshing) refreshAll();
    setPullDistance(0);
    touchStartY.current = null;
  }

  return (
    <div
      className="min-h-screen bg-[#f7f3ed]"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >

      {/* Transient "saved" toast — confirms an existing-line edit reached the server */}
      {savedToast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 bg-primary-800 text-white text-sm font-medium px-4 py-2 rounded-full shadow-lg">
          <Check className="w-4 h-4" />
          Yadda saxlanıldı
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-50 h-14 border-b border-stone-100/60 bg-white/90 backdrop-blur-sm flex items-center gap-3 px-4">
        <div className="flex items-center gap-2">
          {logoUrl ? (
            <img src={tillImage(logoUrl)} alt="" className="w-7 h-7 rounded-lg object-cover border border-stone-100" />
          ) : (
            <div className="w-7 h-7 rounded-lg bg-primary-800 flex items-center justify-center">
              <Coffee className="w-4 h-4 text-white" />
            </div>
          )}
          <span className="font-semibold text-stone-800 text-sm md:hidden truncate max-w-[160px]">{overrideCompanyName || getSession()?.companyName || 'Kafe'}</span>
        </div>
        <div className="flex-1" />
        {/* The desktop shell has no browser chrome, so a till opened from admin
            would be a room with no door. Only shown to a machine that is actually
            signed in — on a waiter's tablet there is no admin to go back to. */}
        {overrideCompanyId && isDesktop() && getSession()?.companyId === overrideCompanyId && (
          <button
            onClick={() => router.push('/admin')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-stone-200 text-sm text-stone-600 hover:bg-stone-50 transition-colors"
            title="Admin panelinə qayıt"
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Admin</span>
          </button>
        )}
        {/* The drawer belongs to whoever is standing at the machine, not to the
            admin panel: change is handed over here, and a note goes in here. Kept
            usable with no printer paired — the drawer opens through the printer
            cable, so an unpaired till pairs first and then kicks it. */}
        <button
          onClick={async () => {
            let ready = printerConnected;
            if (!ready) {
              ready = await selectPrinter();
              setPrinterConnected(ready);
            }
            if (ready) openCashDrawer();
          }}
          title="Pul çəkməcəsini aç"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-50 border border-stone-100 rounded-xl hover:border-emerald-300 hover:bg-emerald-50 transition-colors"
        >
          <Printer className="w-4 h-4 text-emerald-600" />
          <span className="hidden sm:inline text-xs font-semibold text-emerald-700">Pul çəkməcəsi</span>
        </button>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-stone-50 border border-stone-100 rounded-xl">
          <div className="w-6 h-6 rounded-full bg-primary-100 flex items-center justify-center text-primary-900 text-xs font-bold">
            {effectiveSeller[0]?.toUpperCase()}
          </div>
          <span className="text-sm font-medium text-stone-700 hidden sm:inline">{effectiveSeller}</span>
        </div>
        {pinEnabled && activeStaff && (
          <button
            onClick={() => { sessionStorage.removeItem('activeStaff'); setActiveStaff(null); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-stone-200 text-sm text-stone-600 hover:bg-stone-50 transition-colors"
            title="Satıcını dəyiş"
          >
            <KeyRound className="w-4 h-4" />
            <span className="hidden sm:inline">Dəyiş</span>
          </button>
        )}
        <InstallPWA />
      </header>

      {/* Pull-to-refresh indicator */}
      {(pullDistance > 0 || pullRefreshing) && (
        <div
          className="flex items-center justify-center gap-2 text-sm text-stone-500 overflow-hidden"
          style={{ height: pullRefreshing ? 44 : Math.round(pullDistance * (44 / PULL_THRESHOLD)) }}
        >
          {pullRefreshing ? (
            <><span className="w-4 h-4 border-2 border-stone-300 border-t-primary-800 rounded-full animate-spin" /><span>Yenilənir...</span></>
          ) : (
            <>
              <span style={{ display: 'inline-block', transform: `rotate(${pullDistance >= PULL_THRESHOLD ? 180 : 0}deg)`, transition: 'transform 0.2s' }}>↓</span>
              <span>{pullDistance >= PULL_THRESHOLD ? 'Buraxın' : 'Yeniləmək üçün çəkin'}</span>
            </>
          )}
        </div>
      )}

      {/* ── Subscription warning banner ── */}
      {(() => {
        if (!expiresAt) return null;
        const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000);
        if (days > 10) return null;
        const expired = days < 0;
        return (
          <div className={`relative flex items-center justify-between gap-4 px-5 py-3 ${expired ? 'bg-red-600' : 'bg-primary-500'}`}>
            <div className="flex items-center gap-3">
              <span className={`w-2 h-2 rounded-full animate-pulse shrink-0 ${expired ? 'bg-red-200' : 'bg-primary-200'}`} />
              <p className="text-white text-sm font-medium">
                {expired
                  ? 'Abunəliyinizin müddəti bitib. Sistemə giriş məhdudlaşdırıla bilər.'
                  : `Abunəliyinizin müddəti ${days} gün sonra bitir. Xidmətin fasiləsiz davam etməsi üçün ödənişi tamamlayın.`}
              </p>
            </div>
            <a
              href="https://wa.me/994998989876"
              target="_blank"
              rel="noopener noreferrer"
              className={`shrink-0 text-xs font-bold px-4 py-1.5 rounded-lg transition-colors ${expired ? 'bg-white text-red-600 hover:bg-red-50' : 'bg-white text-primary-600 hover:bg-primary-50'}`}
            >
              Ödəniş et
            </a>
          </div>
        );
      })()}

      <div className="flex min-h-[calc(100vh-3.5rem)] bg-white">

        {/* Desktop sidebar */}
        <aside className={`hidden md:block flex-shrink-0 sticky top-14 self-start h-[calc(100vh-3.5rem)] transition-all duration-200 border-r border-stone-100/60 ${collapsed ? 'w-14' : 'w-56'}`}>
          <SidebarContent />
        </aside>

        {/* Main — pb-16 reserves space for mobile bottom nav */}
        <main className="flex-1 min-w-0 bg-[#f7f3ed] md:rounded-tl-2xl md:border-l md:border-t border-stone-100/60 overflow-hidden flex flex-col pb-16 lg:pb-0">

          {/* ── ORDERS ── */}
          {view === 'orders' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="px-4 md:px-6 pt-5 pb-2">
                <h1 className="text-lg font-semibold text-stone-900">Sifarişlər</h1>
                <p className="text-sm text-stone-600 mt-0.5">Aktiv sifarişlər</p>
              </div>

              {/* Last resort only. The waiter's own tapping normally arms the sound
                  before this can appear; it shows for the screen nobody touches, or
                  when the browser refused a gesture we did get. */}
              {soundOn && !deviceMuted && !soundReady && soundBlocked && (
                <div className="mx-4 md:mx-6 mb-2 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
                  <Bell className="w-4 h-4 text-amber-600 shrink-0" />
                  <p className="flex-1 text-sm text-amber-900">Yeni sifariş səsi söndürülüb — brauzer icazə istəyir.</p>
                  <button
                    onClick={enableSound}
                    className="shrink-0 text-sm font-medium bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Səsi aktivləşdir
                  </button>
                </div>
              )}

              {soundOn && soundReady && !deviceMuted && (
                <div className="px-4 md:px-6 -mt-1 mb-1">
                  <button
                    onClick={muteDevice}
                    className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-600 transition-colors"
                  >
                    <Bell className="w-3.5 h-3.5" /> Səs açıqdır — bu cihazda söndür
                  </button>
                </div>
              )}

              {soundOn && deviceMuted && (
                <div className="px-4 md:px-6 -mt-1 mb-1">
                  <button
                    onClick={enableSound}
                    className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-600 transition-colors"
                  >
                    <BellOff className="w-3.5 h-3.5" /> Səs söndürülüb — aç
                  </button>
                </div>
              )}

              <div className="px-4 md:px-6 py-2 flex items-center gap-3 flex-wrap">
                <button
                  onClick={() => refreshOrders()}
                  disabled={refreshing}
                  className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-600 border border-stone-200 rounded-lg px-3 py-1.5 hover:bg-white transition-colors bg-white disabled:opacity-60"
                >
                  {refreshing
                    ? <span className="w-3.5 h-3.5 border-2 border-stone-200 border-t-[#92400e] rounded-full animate-spin" />
                    : <span>↻</span>}
                  Yenilə
                </button>
                <div className="flex gap-3 text-sm flex-wrap">
                  <span className="text-stone-600">Cəmi <span className="font-semibold text-stone-800">{active.length}</span></span>
                  <span className="text-stone-600">Gözləyir <span className="font-semibold text-primary-700">{orders.filter(o => o.status === 'gözləyir').length}</span></span>
                  <span className="text-stone-600">Hazır <span className="font-semibold text-green-600">{orders.filter(o => o.status === 'hazırdır').length}</span></span>
                </div>
              </div>

              {/* Desktop table header */}
              <div className="hidden md:grid grid-cols-[120px_1fr_140px_200px_110px] gap-4 px-6 py-2 text-xs font-medium text-stone-500 uppercase tracking-wide border-b border-t bg-white">
                <span>Vaxt</span><span>Sifariş</span><span>Durum</span><span></span><span className="text-right">Ümumi</span>
              </div>

              <div className="flex-1 overflow-y-auto relative">
                {active.length === 0 && (
                  <div className="text-center py-20 text-stone-500">
                    <div className="text-5xl mb-3">📋</div>
                    <p>Aktiv sifariş yoxdur</p>
                  </div>
                )}
                {prevOrders.length > 0 && (
                  <div>
                    <div className="px-4 md:px-6 py-2 bg-stone-100 text-xs font-semibold text-stone-600 uppercase tracking-wide">Əvvəlki günlər · {prevOrders.length}</div>
                    {prevOrders.map(o => <OrderRow key={o.id} order={o} tableLabel={tableName(o.tableNumber)} tz={bizSettings.timezone} printFailed={printFailed.has(o.id)} progress={readyProgress(o)} isItemReady={item => isItemReady(o, item)} onReprint={() => handleReprint(o.id)} onPay={() => openPayment(o)} onCancel={() => openCancel(o)} onAppend={() => startAppend(o)} onMove={() => openMove(o)} onPrintBill={() => handlePrintBill(o)} billBusy={printBillBusy === o.id} onStatusChange={handleStatusChange} />)}
                  </div>
                )}
                {todayOrders.length > 0 && (
                  <div>
                    <div className="px-4 md:px-6 py-2 bg-stone-100 text-xs font-semibold text-stone-600 uppercase tracking-wide">Bu gün · {todayOrders.length}</div>
                    {todayOrders.map(o => <OrderRow key={o.id} order={o} tableLabel={tableName(o.tableNumber)} tz={bizSettings.timezone} printFailed={printFailed.has(o.id)} progress={readyProgress(o)} isItemReady={item => isItemReady(o, item)} onReprint={() => handleReprint(o.id)} onPay={() => openPayment(o)} onCancel={() => openCancel(o)} onAppend={() => startAppend(o)} onMove={() => openMove(o)} onPrintBill={() => handlePrintBill(o)} billBusy={printBillBusy === o.id} onStatusChange={handleStatusChange} />)}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── HISTORY ── */}
          {view === 'history' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="px-4 md:px-6 pt-5 pb-2 flex items-end justify-between gap-3">
                <div>
                  <h1 className="text-lg font-semibold text-stone-900">Bu günün sifarişləri</h1>
                  <p className="text-sm text-stone-600 mt-0.5">
                    {historyLoading ? 'Yüklənir...' : `${historyOrders.length} sifariş`}
                  </p>
                </div>
                <button
                  onClick={() => {
                    const todayStr = businessToday(bizSettings);
                    const from = businessDayStartUtc(todayStr, bizSettings).toISOString();
                    const to = new Date().toISOString();
                    setHistoryLoading(true);
                    const load = overrideCompanyId
                      ? tillFetch(`/api/public-orders?companyId=${overrideCompanyId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=500`)
                          .then(r => r.json()).then(d => d.orders ?? []).catch(() => [])
                      : fetchOrders({ from, to, limit: 500 });
                    load.then(setHistoryOrders).finally(() => setHistoryLoading(false));
                  }}
                  disabled={historyLoading}
                  className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-600 border border-stone-200 rounded-lg px-3 py-1.5 hover:bg-white transition-colors bg-white disabled:opacity-60"
                >
                  {historyLoading
                    ? <span className="w-3.5 h-3.5 border-2 border-stone-200 border-t-[#92400e] rounded-full animate-spin" />
                    : <span>↻</span>}
                  Yenilə
                </button>
              </div>

              {/* Nağd / Kart summary */}
              {!historyLoading && historyOrders.length > 0 && (
                <div className="px-4 md:px-6 pb-2">
                  <div className="flex gap-3">
                    <div className="flex-1 bg-white rounded-xl border border-stone-100 px-4 py-3">
                      <p className="text-xs text-stone-500 mb-0.5">Nağd</p>
                      <p className="text-lg font-bold text-stone-800">{historyNagd.toFixed(2)} ₼</p>
                    </div>
                    <div className="flex-1 bg-white rounded-xl border border-stone-100 px-4 py-3">
                      <p className="text-xs text-stone-500 mb-0.5">Kart</p>
                      <p className="text-lg font-bold text-stone-800">{historyKart.toFixed(2)} ₼</p>
                    </div>
                    <div className="flex-1 bg-primary-50 rounded-xl border border-primary-100 px-4 py-3">
                      <p className="text-xs text-primary-700 mb-0.5">Cəmi</p>
                      <p className="text-lg font-bold text-primary-800">{historyRevenue.toFixed(2)} ₼</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="px-4 md:px-6 py-2">
                <div className="relative max-w-md">
                  <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    value={historySearch}
                    onChange={e => setHistorySearch(e.target.value)}
                    placeholder="Sifariş №, masa və ya satıcı ilə axtar"
                    className="w-full bg-white border border-stone-200 rounded-xl pl-9 pr-3 py-2 text-sm text-stone-700 placeholder:text-stone-400 focus:outline-none focus:border-primary-300"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 md:px-6 pb-4">
                {historyLoading && (
                  <div className="flex justify-center py-20">
                    <span className="w-7 h-7 border-2 border-stone-200 border-t-[#92400e] rounded-full animate-spin" />
                  </div>
                )}

                {!historyLoading && historyOrders.length === 0 && (
                  <div className="text-center py-20 text-stone-500">
                    <div className="text-5xl mb-3">🕐</div>
                    <p>Bu gün hələlik sifariş yoxdur</p>
                  </div>
                )}

                {!historyLoading && historyOrders.length > 0 && filteredHistoryOrders.length === 0 && (
                  <div className="bg-white rounded-xl border border-stone-100 p-10 text-center">
                    <p className="text-sm text-stone-500">Axtarışa uyğun sifariş tapılmadı</p>
                  </div>
                )}

                {!historyLoading && filteredHistoryOrders.length > 0 && (
                  <div className="bg-white rounded-xl border border-stone-100 overflow-hidden">
                    {filteredHistoryOrders.map((order, i) => {
                      const isExpanded = expandedOrderId === order.id;
                      const tLabel = tableName(order.tableNumber);
                      const closedAt = orderClosedAt(order);
                      return (
                        <div key={order.id} className={i < filteredHistoryOrders.length - 1 ? 'border-b border-stone-50' : ''}>
                          <button
                            onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
                            className="w-full flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 hover:bg-stone-50 transition-colors text-left"
                          >
                            <ChevronDown className={`w-4 h-4 text-stone-400 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                            <span className="w-12 text-xs font-bold text-primary-900 flex-shrink-0">№{orderLabel(order)}</span>
                            <span className="flex-1 text-sm text-stone-700 truncate">
                              {[tLabel, order.sellerName].filter(Boolean).join(' · ')}
                            </span>
                            <span className="text-xs text-stone-500 flex-shrink-0 hidden sm:block">
                              {new Date(order.createdAt).toLocaleDateString('az-AZ', { day: 'numeric', month: 'short', timeZone: bizSettings.timezone })},{' '}
                              {new Date(order.createdAt).toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit', timeZone: bizSettings.timezone })}
                              {' → '}
                              {closedAt
                                ? new Date(closedAt).toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit', timeZone: bizSettings.timezone })
                                : '—'}
                            </span>
                            <span className="text-sm font-semibold text-stone-800 flex-shrink-0 text-right">
                              {(order.discountAmount ?? 0) > 0
                                ? <><span className="text-xs text-stone-400 line-through mr-1">{(orderTotal(order) + order.discountAmount!).toFixed(2)}</span>{orderTotal(order).toFixed(2)}</>
                                : orderTotal(order).toFixed(2)
                              } ₼
                            </span>
                            {(order.discountAmount ?? 0) > 0 && (
                              <span className="text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-lg px-1.5 py-0.5 flex-shrink-0 hidden sm:inline">
                                🏷️ -{order.discountAmount!.toFixed(2)} ₼
                              </span>
                            )}
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 text-center truncate ${STATUS_COLORS[order.status]}`}>{STATUS_LABELS[order.status]}</span>
                          </button>

                          {isExpanded && (
                            <div className="px-4 pb-4 bg-stone-50 border-t border-stone-100">
                              <p className="pt-3 text-xs text-stone-500 sm:hidden">
                                Açıldı: {new Date(order.createdAt).toLocaleDateString('az-AZ', { day: 'numeric', month: 'short', timeZone: bizSettings.timezone })},{' '}
                                {new Date(order.createdAt).toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit', timeZone: bizSettings.timezone })}
                                {' · '}
                                {closedAt
                                  ? `Bağlandı: ${new Date(closedAt).toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit', timeZone: bizSettings.timezone })}`
                                  : 'açıqdır'}
                              </p>
                              <div className="pt-3 space-y-1 mb-3">
                                {order.items.map((oi, j) => (
                                  <div key={j} className="flex justify-between text-sm text-stone-700 py-0.5">
                                    <span className="flex-1">
                                      {oi.menuItem.name}
                                      {oi.modifiers && <span className="text-xs text-primary-600 ml-1">({oi.modifiers})</span>}
                                    </span>
                                    <span className="text-stone-500 mx-4">{oi.quantity} əd</span>
                                    <span className="font-medium">{(oi.menuItem.price * oi.quantity).toFixed(2)} ₼</span>
                                  </div>
                                ))}
                              </div>
                              {order.note && <p className="text-xs text-stone-500 italic mb-3">Qeyd: {order.note}</p>}
                              {order.status === 'ləğv edildi' && (
                                <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">
                                  Ödənişsiz bağlandı{order.cancelledBy ? ` — ${order.cancelledBy}` : ''}
                                  {order.cancelledAt ? `, ${new Date(order.cancelledAt).toLocaleString('az-AZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: bizSettings.timezone })}` : ''}
                                  {order.cancelReason ? ` · Səbəb: ${order.cancelReason}` : ''}
                                </p>
                              )}
                              <div className="flex items-center justify-between gap-2 flex-wrap pt-2 border-t border-stone-200">
                                <div className="flex items-center gap-2 flex-wrap">
                                  {isOrderOpen(order) && (
                                    <>
                                      <button
                                        onClick={() => openPayment(order)}
                                        className="text-xs font-semibold text-white bg-primary-800 hover:bg-primary-900 rounded-lg px-2.5 py-1 transition-colors"
                                      >
                                        Ödəniş
                                      </button>
                                      <button
                                        onClick={() => openCancel(order)}
                                        className="text-xs font-semibold text-red-500 border border-red-200 hover:bg-red-50 rounded-lg px-2.5 py-1 transition-colors"
                                      >
                                        Ödənişsiz bağla
                                      </button>
                                    </>
                                  )}
                                  {order.status === 'ödənilib' && (
                                    <button
                                      onClick={() => handleReprintReceipt(order)}
                                      disabled={printBillBusy === order.id}
                                      className="text-xs font-semibold text-stone-600 border border-stone-300 hover:bg-white rounded-lg px-2.5 py-1 transition-colors disabled:opacity-50"
                                    >
                                      {printBillBusy === order.id ? 'Çap olunur...' : 'Qəbzi çap et'}
                                    </button>
                                  )}
                                  {(order.cashAmount || order.cardAmount) && (
                                    <span className="text-xs text-stone-500">
                                      {[order.cashAmount ? `💵 ${order.cashAmount.toFixed(2)}` : '', order.cardAmount ? `💳 ${order.cardAmount.toFixed(2)}` : ''].filter(Boolean).join(' · ')}
                                    </span>
                                  )}
                                  {(order.discountAmount ?? 0) > 0 && (
                                    <span className="text-xs font-semibold text-green-600 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">
                                      🏷️ endirim -{order.discountAmount!.toFixed(2)} ₼{order.discountType === '%' ? ` (${order.discountType})` : ''}
                                    </span>
                                  )}
                                  {(order.changeAmount ?? 0) > 0 && (
                                    <span className="text-xs text-stone-500">
                                      💸 {((order.cashAmount ?? 0) + order.changeAmount!).toFixed(2)} alındı · {order.changeAmount!.toFixed(2)} qaytarıldı
                                    </span>
                                  )}
                                </div>
                                <div className="text-right">
                                  {(order.discountAmount ?? 0) > 0 && <p className="text-xs text-stone-400 line-through">{(orderTotal(order) + order.discountAmount!).toFixed(2)} ₼</p>}
                                  <span className="font-bold text-primary-900">{orderTotal(order).toFixed(2)} ₼</span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

              </div>
            </div>
          )}

          {/* ── KASSA ── */}
          {view === 'kassa' && shift && (
            <div className="flex-1 p-4 md:p-8 overflow-y-auto">
              <div className="max-w-md space-y-4">
                <div>
                  <h1 className="text-lg font-semibold text-stone-900">Kassa</h1>
                  <p className="text-sm text-stone-600 mt-0.5">
                    Açılıb: {new Date(shift.openedAt).toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit', timeZone: bizSettings.timezone })} · {shift.openedBy}
                  </p>
                </div>

                {/* Summary */}
                <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5 space-y-2.5">
                  <div className="flex justify-between text-sm text-stone-600">
                    <span>Başlanğıc məbləğ</span><span className="font-semibold">{shift.openingCash.toFixed(2)} ₼</span>
                  </div>
                  <div className="flex justify-between text-sm text-stone-600">
                    <span>Nağd satış</span><span className="font-semibold">{shiftSales.cash.toFixed(2)} ₼</span>
                  </div>
                  {movementsTotal(shift) !== 0 && (
                    <div className="flex justify-between text-sm text-stone-600">
                      <span>Mədaxil / məxaric</span>
                      <span className={`font-semibold ${movementsTotal(shift) < 0 ? 'text-red-500' : 'text-green-600'}`}>
                        {movementsTotal(shift) > 0 ? '+' : ''}{movementsTotal(shift).toFixed(2)} ₼
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between items-center border-t pt-3 font-bold text-lg">
                    <span>Kassada olmalıdır</span><span className="text-primary-700">{expectedCash.toFixed(2)} ₼</span>
                  </div>
                </div>

                {/* Terminal (card) — separate from drawer math */}
                <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5">
                  <div className="flex justify-between items-center font-bold">
                    <span className="text-stone-800">💳 Terminal (kart satışı)</span>
                    <span className="text-primary-700 text-lg">{shiftSales.card.toFixed(2)} ₼</span>
                  </div>
                  <p className="text-xs text-stone-500 mt-1">Kassaya daxil deyil — bank terminalından keçir</p>
                </div>

                {/* Movements */}
                <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="font-semibold text-stone-800 text-sm">Mədaxil / məxaric</h2>
                    <button
                      onClick={() => setShowMovForm(v => !v)}
                      className="text-xs font-semibold text-primary-800 hover:text-primary-950 px-2.5 py-1 rounded-lg hover:bg-primary-50 transition-colors"
                    >
                      {showMovForm ? 'Bağla' : '+ Əlavə et'}
                    </button>
                  </div>
                  {showMovForm && (
                    <div className="mb-3 p-3 bg-stone-50 rounded-xl space-y-2">
                      <div className="flex rounded-lg overflow-hidden border border-stone-200">
                        <button
                          onClick={() => setMovOut(true)}
                          className={`flex-1 py-2 text-xs font-semibold transition-colors ${movOut ? 'bg-red-500 text-white' : 'bg-white text-stone-600'}`}
                        >− Məxaric</button>
                        <button
                          onClick={() => setMovOut(false)}
                          className={`flex-1 py-2 text-xs font-semibold transition-colors ${!movOut ? 'bg-green-500 text-white' : 'bg-white text-stone-600'}`}
                        >+ Mədaxil</button>
                      </div>
                      <input
                        type="number" min="0" step="0.01" placeholder="Məbləğ (₼)"
                        value={movAmount} onChange={e => setMovAmount(e.target.value)}
                        className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary-700"
                      />
                      <input
                        type="text" placeholder="Səbəb (məs. su kuryeri)"
                        value={movReason} onChange={e => setMovReason(e.target.value)}
                        className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-700"
                      />
                      <button
                        onClick={handleAddMovement}
                        disabled={!(parseFloat(movAmount) > 0) || !movReason.trim()}
                        className="w-full bg-primary-800 hover:bg-primary-900 disabled:opacity-40 text-white text-sm font-semibold py-2 rounded-lg transition-colors"
                      >Yadda saxla</button>
                    </div>
                  )}
                  {shift.movements.length === 0
                    ? <p className="text-xs text-stone-500">Hərəkət yoxdur</p>
                    : (
                      <ul className="space-y-1.5">
                        {shift.movements.map((m, i) => (
                          <li key={i} className="flex justify-between text-sm">
                            <span className="text-stone-600 truncate mr-3">
                              {m.reason}
                              <span className="text-xs text-stone-500 ml-1.5">
                                {new Date(m.at).toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit', timeZone: bizSettings.timezone })} · {m.by}
                              </span>
                            </span>
                            <span className={`font-semibold shrink-0 ${m.amount < 0 ? 'text-red-500' : 'text-green-600'}`}>
                              {m.amount > 0 ? '+' : ''}{m.amount.toFixed(2)} ₼
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                </div>

                {/* Close shift */}
                <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5">
                  <h2 className="font-semibold text-stone-800 text-sm mb-3">Növbəni bağla</h2>
                  <label className="block text-xs font-medium text-stone-600 mb-1.5">Sayılan nağd (₼)</label>
                  <input
                    type="number" min="0" step="0.01" placeholder="0.00"
                    value={countedInput} onChange={e => setCountedInput(e.target.value)}
                    className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-base font-semibold text-center focus:outline-none focus:ring-2 focus:ring-primary-700 mb-3"
                  />
                  {countedInput !== '' && (
                    <div className={`flex justify-between items-center px-4 py-2.5 rounded-xl font-semibold text-sm mb-3 ${
                      Math.abs((parseFloat(countedInput) || 0) - expectedCash) < 0.005
                        ? 'bg-green-50 text-green-700'
                        : (parseFloat(countedInput) || 0) < expectedCash ? 'bg-red-50 text-red-600' : 'bg-primary-50 text-primary-700'
                    }`}>
                      <span>
                        {Math.abs((parseFloat(countedInput) || 0) - expectedCash) < 0.005
                          ? 'Dəqiq ✓'
                          : (parseFloat(countedInput) || 0) < expectedCash ? 'Kəsir' : 'Artıq'}
                      </span>
                      <span>{((parseFloat(countedInput) || 0) - expectedCash).toFixed(2)} ₼</span>
                    </div>
                  )}
                  <label className="block text-xs font-medium text-stone-600 mb-1.5">💳 Terminal məbləği (Z-hesabat, ₼)</label>
                  <input
                    type="number" min="0" step="0.01" placeholder="0.00"
                    value={terminalInput} onChange={e => setTerminalInput(e.target.value)}
                    className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-base font-semibold text-center focus:outline-none focus:ring-2 focus:ring-primary-700 mb-3"
                  />
                  {terminalInput !== '' && (
                    <div className={`flex justify-between items-center px-4 py-2.5 rounded-xl font-semibold text-sm mb-3 ${
                      Math.abs((parseFloat(terminalInput) || 0) - shiftSales.card) < 0.005
                        ? 'bg-green-50 text-green-700'
                        : (parseFloat(terminalInput) || 0) < shiftSales.card ? 'bg-red-50 text-red-600' : 'bg-primary-50 text-primary-700'
                    }`}>
                      <span>
                        {Math.abs((parseFloat(terminalInput) || 0) - shiftSales.card) < 0.005
                          ? 'Terminal düz gəlir ✓'
                          : (parseFloat(terminalInput) || 0) < shiftSales.card ? 'Terminal kəsir' : 'Terminal artıq'}
                      </span>
                      <span>{((parseFloat(terminalInput) || 0) - shiftSales.card).toFixed(2)} ₼</span>
                    </div>
                  )}
                  <button
                    onClick={handleCloseShift}
                    disabled={shiftBusy || countedInput === ''}
                    className="w-full bg-stone-900 hover:bg-stone-800 disabled:opacity-40 text-white font-semibold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    {shiftBusy && <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                    Növbəni bağla
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── NEW ORDER ── */}
          {view === 'new-order' && (
            <div className="flex-1 p-5 md:p-8 overflow-y-auto">
              <h1 className="text-lg font-semibold text-stone-900 mb-1">Yeni sifariş</h1>
              <p className="text-sm text-stone-600 mb-6">Sifariş növünü seçin</p>

              <div className="grid grid-cols-2 gap-4 max-w-xs mb-8">
                <button
                  onClick={() => setOrderType('masa')}
                  className={`flex flex-col items-center gap-3 p-6 rounded-2xl border-2 transition-all active:scale-95 ${orderType === 'masa' ? 'border-primary-800 bg-primary-50' : 'border-stone-200 bg-white hover:border-primary-300'}`}
                >
                  <UtensilsCrossed className={`w-8 h-8 ${orderType === 'masa' ? 'text-primary-800' : 'text-stone-500'}`} />
                  <span className={`font-semibold text-sm ${orderType === 'masa' ? 'text-primary-800' : 'text-stone-600'}`}>Masa</span>
                </button>
                <button
                  onClick={() => startNewOrder('takeaway')}
                  className="flex flex-col items-center gap-3 p-6 rounded-2xl border-2 border-stone-200 bg-white hover:border-primary-300 transition-all active:scale-95"
                >
                  <span className="text-4xl">🥡</span>
                  <span className="font-semibold text-sm text-stone-600">Takeaway</span>
                </button>
              </div>

              {orderType === 'masa' && (
                <div>
                  <p className="text-sm font-medium text-stone-700 mb-3">Masanı seçin</p>
                  {halls.length > 1 && (
                    <div className="flex flex-wrap gap-1 bg-stone-100 rounded-xl p-1 mb-3 max-w-fit">
                      {halls.map(h => (
                        <button
                          key={h.id}
                          onClick={() => setActiveHallId(h.id)}
                          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors active:scale-95 ${
                            activeHallId === h.id ? 'bg-white shadow-sm text-stone-800' : 'text-stone-500 hover:text-stone-700'
                          }`}
                        >
                          {h.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-3 text-xs text-stone-600 mb-4">
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-100 border border-green-300 inline-block" /> Boş</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-100 border border-red-300 inline-block" /> Dolu</span>
                  </div>
                  <div
                    className="relative border border-stone-200 rounded-xl bg-white overflow-auto"
                    style={{
                      height: 440,
                      maxWidth: 700,
                      backgroundImage: 'radial-gradient(circle, #d1d5db 1px, transparent 1px)',
                      backgroundSize: '24px 24px',
                    }}
                  >
                    {hallTables.map((t, i) => {
                      const busy = tableHasActive(t.id, orders);
                      const posX = t.x ?? (20 + (i % 5) * 130);
                      const posY = t.y ?? (20 + Math.floor(i / 5) * 110);
                      const w = t.w ?? 100;
                      const h = t.h ?? 70;
                      const isRound = t.shape === 'round';
                      const busyTotal = orders
                        .filter(o => o.tableNumber === t.id && isOrderOpen(o))
                        .reduce((s, o) => s + orderTotal(o), 0);
                      return (
                        <button
                          key={t.id}
                          onClick={() => startNewOrder('masa', t.id)}
                          style={{
                            position: 'absolute',
                            left: posX,
                            top: posY,
                            width: w,
                            height: h,
                            borderRadius: isRound ? '50%' : 12,
                          }}
                          className={`flex flex-col items-center justify-center border-2 shadow-sm transition-all active:scale-95 hover:shadow-md hover:scale-105 ${
                            busy
                              ? 'bg-red-50 border-red-300 text-red-800 hover:bg-red-100'
                              : 'bg-green-50 border-green-300 text-green-800 hover:bg-green-100'
                          }`}
                        >
                          <span className="font-bold text-sm leading-tight truncate px-1 max-w-full">{t.name}</span>
                          {busy && busyTotal > 0
                            ? <span className="text-[10px] opacity-80 font-semibold">{busyTotal.toFixed(0)} ₼</span>
                            : <span className="text-[10px] opacity-60">{t.capacity} nəfər</span>
                          }
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── MENU ── */}
          {view === 'menu' && (
            <div className="flex-1 flex overflow-hidden">
              <div className="flex-1 flex flex-col overflow-hidden">

                {/* Menu toolbar */}
                <div className="px-3 py-2.5 border-b bg-white flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => { if (appendOrderId) { cancelAppend(); return; } setView(tablesOn ? 'new-order' : 'orders'); setOrderType(tablesOn ? 'masa' : null); setCart([]); setMenuSearch(''); }}
                    className="w-9 h-9 flex items-center justify-center rounded-xl text-primary-700 hover:bg-primary-50 active:scale-95 transition-all"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      value={menuSearch}
                      onChange={e => setMenuSearch(e.target.value)}
                      placeholder="Məhsul axtar..."
                      className="w-full bg-stone-50 border border-stone-200 rounded-xl pl-9 pr-8 py-2 text-sm text-stone-700 placeholder:text-stone-400 focus:outline-none focus:border-primary-300"
                    />
                    {menuSearch && (
                      <button onClick={() => setMenuSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  {/* Cart icon — mobile only */}
                  <button
                    onClick={() => setMobileCartOpen(true)}
                    className="lg:hidden relative w-9 h-9 flex items-center justify-center rounded-xl text-stone-600 hover:bg-stone-100 active:scale-95"
                  >
                    <ShoppingCart className="w-5 h-5" />
                    {cartCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-primary-800 text-white text-[10px] rounded-full flex items-center justify-center font-bold">{cartCount}</span>
                    )}
                  </button>
                </div>

                {/* Category tabs */}
                <div className="bg-white border-b py-2 flex items-center gap-1 shrink-0 px-1">
                  <button
                    onClick={() => catScrollRef.current?.scrollBy({ left: -160, behavior: 'smooth' })}
                    className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-stone-400 hover:bg-stone-100 hover:text-stone-700 transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <div ref={catScrollRef} className="flex gap-2 overflow-x-auto scrollbar-none flex-1">
                    {categories.map(cat => {
                      const count = menu.filter(m => m.category === cat && m.available).length;
                      return (
                        <button
                          key={cat}
                          onClick={() => setActiveCategory(cat)}
                          className={`whitespace-nowrap text-sm px-3 py-1.5 rounded-full font-medium transition-colors shrink-0 flex items-center gap-1.5 ${activeCategory === cat ? 'bg-primary-800 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
                        >
                          {cat}
                          <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${activeCategory === cat ? 'bg-primary-700 text-primary-100' : 'bg-stone-200 text-stone-600'}`}>{count}</span>
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => catScrollRef.current?.scrollBy({ left: 160, behavior: 'smooth' })}
                    className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-stone-400 hover:bg-stone-100 hover:text-stone-700 transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                {/* Menu grid */}
                <div
                  className="flex-1 overflow-y-auto p-3 grid grid-cols-2 sm:grid-cols-3 gap-3 content-start bg-stone-50"
                  style={{ paddingBottom: cartCount > 0 ? '5.5rem' : '0.75rem' }}
                >
                  {filtered.map(item => {
                    const inCart = cart.filter(ci => ci.menuItem.id === item.id).reduce((s, ci) => s + ci.quantity, 0);
                    return (
                      <div key={item.id} className="bg-white rounded-2xl shadow-sm border border-transparent hover:border-primary-200 transition-all relative overflow-hidden">
                        <button
                          onClick={() => handleMenuItemTap(item)}
                          className="w-full text-left active:scale-95"
                        >
                          {inCart > 0 && (
                            <span className="absolute top-2 right-2 z-10 bg-primary-800 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">{inCart}</span>
                          )}
                          {item.image
                            ? <img src={tillImage(item.image)} alt={item.name} className="w-full aspect-[4/3] object-contain bg-white p-2" />
                            : <div className="w-full aspect-[4/3] bg-primary-50 flex items-center justify-center text-3xl">☕</div>
                          }
                          <div className="p-2.5">
                            <p className="text-sm font-medium text-stone-800 leading-tight">{item.name}</p>
                            <p className="text-primary-700 font-bold text-sm mt-0.5">{item.price.toFixed(2)} ₼</p>
                          </div>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Desktop cart sidebar */}
              <div className="hidden lg:flex w-72 bg-white border-l flex-col">
                <div className="px-4 py-3 border-b">
                  {clearConfirm ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-stone-700 flex-1">Səbəti təmizlə?</span>
                      <button onClick={() => { setCart([]); setNote(''); setClearConfirm(false); }} className="text-xs font-semibold text-white bg-red-500 hover:bg-red-600 px-2.5 py-1 rounded-lg transition-colors">Bəli</button>
                      <button onClick={() => setClearConfirm(false)} className="text-xs font-semibold text-stone-600 border border-stone-200 hover:bg-stone-50 px-2.5 py-1 rounded-lg transition-colors">Xeyr</button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="font-bold text-stone-800">{appendOrder ? 'Əlavə' : 'Sifariş'} {cartCount > 0 && <span className="text-primary-700">({cartCount})</span>}</h2>
                        <p className="text-xs text-stone-500">{appendOrder ? `№${orderLabel(appendOrder)}-ə əlavə` : !tablesOn ? 'Yeni sifariş' : orderType === 'takeaway' ? 'Takeaway' : tableName(selectedTable)}</p>
                      </div>
                      {cart.length > 0 && (
                        <button onClick={() => setClearConfirm(true)} className="w-7 h-7 flex items-center justify-center rounded-lg text-stone-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto px-4 py-3">
                  {appendOrder
                    ? <CartItems cart={cart} existingItems={appendOrder.items} removedItems={appendOrder.removedItems} addToCart={addToCart} removeFromCart={removeFromCart} onDecrementExisting={oi => handleDecrementItem(appendOrder, oi)} />
                    : cart.length === 0
                    ? <p className="text-center text-stone-500 text-sm py-8">Boşdur</p>
                    : <CartItems cart={cart} addToCart={addToCart} removeFromCart={removeFromCart} />
                  }
                </div>
                <div className="px-4 py-3 border-t space-y-3">
                  <textarea
                    placeholder="Qeyd..."
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    rows={2}
                    className="w-full text-sm border border-stone-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary-400"
                  />
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-stone-600">Cəmi:</span>
                    <span className="font-bold text-lg text-primary-700">{cartTotal.toFixed(2)} ₼</span>
                  </div>
                  <button
                    onClick={submitOrder}
                    disabled={cart.length === 0 || submitting}
                    className="w-full bg-primary-800 hover:bg-primary-900 disabled:bg-stone-300 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    {submitting && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                    {submitting ? 'Göndərilir...' : appendOrder ? 'Əlavə et' : 'Sifariş ver'}
                  </button>
                </div>
              </div>

              {/* Mobile floating cart bar. Stays visible throughout append mode (even with an empty
                  cart) so it's always the way into the panel; falls back to the existing order's
                  count/total until new items are added. */}
              {(cartCount > 0 || appendOrder) && (
                <div className="lg:hidden fixed bottom-16 inset-x-0 z-30 px-4 pb-2 pointer-events-none">
                  <button
                    onClick={() => setMobileCartOpen(true)}
                    className="pointer-events-auto w-full bg-primary-800 text-white rounded-2xl py-3.5 flex items-center justify-between px-5 shadow-lg active:scale-95 transition-transform"
                  >
                    {(() => {
                      const barCount = cartCount > 0 ? cartCount : appendOrder ? appendOrder.items.reduce((s, oi) => s + oi.quantity, 0) : 0;
                      const barTotal = cartCount > 0 ? cartTotal : appendOrder ? appendOrder.items.reduce((s, oi) => s + oi.menuItem.price * oi.quantity, 0) : 0;
                      return (
                        <>
                          <span className="bg-white/20 text-white text-xs font-bold px-2 py-0.5 rounded-full min-w-[1.5rem] text-center">{barCount}</span>
                          <span className="font-semibold text-sm">Sifarişi gör</span>
                          <span className="font-bold">{barTotal.toFixed(2)} ₼</span>
                        </>
                      );
                    })()}
                  </button>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-stone-200 flex safe-area-inset-bottom">
        {[
          { id: 'orders' as View,    label: 'Sifarişlər',   icon: Receipt },
          { id: 'new-order' as View, label: 'Yeni sifariş', icon: ShoppingBag },
          ...(kassaOn ? [{ id: 'kassa' as View, label: 'Kassa', icon: Wallet }] : []),
          { id: 'history' as View,   label: 'Tarixçə',      icon: History },
        ].map(n => {
          const Icon = n.icon;
          const isActive = view === n.id || (n.id === 'new-order' && view === 'menu');
          const badge = n.id === 'orders' && active.length > 0 ? active.length : null;
          return (
            <button
              key={n.id}
              onClick={() => handleNav(n.id)}
              className={`flex-1 flex flex-col items-center gap-1 py-2.5 relative transition-colors active:opacity-70 ${isActive ? 'text-primary-800' : 'text-stone-500'}`}
            >
              <div className="relative">
                <Icon className="w-5 h-5" />
                {badge && (
                  <span className="absolute -top-1.5 -right-2 w-4 h-4 bg-primary-800 text-white text-[9px] rounded-full flex items-center justify-center font-bold">{badge}</span>
                )}
              </div>
              <span className="text-[10px] font-medium">{n.label}</span>
              {isActive && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary-800 rounded-full" />}
            </button>
          );
        })}
      </nav>

      {/* PIN lock screen — covers everything until a staff member unlocks */}

      {/* Mobile cart bottom sheet */}
      {mobileCartOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-50 lg:hidden" onClick={() => setMobileCartOpen(false)} />
          <div className="fixed bottom-0 inset-x-0 z-[60] bg-white rounded-t-2xl shadow-2xl lg:hidden flex flex-col max-h-[85vh]">
            <div className="px-4 pt-4 pb-3 border-b shrink-0">
              {clearConfirm ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-stone-700 flex-1">Səbəti təmizlə?</span>
                  <button onClick={() => { setCart([]); setNote(''); setClearConfirm(false); }} className="text-xs font-semibold text-white bg-red-500 hover:bg-red-600 px-2.5 py-1 rounded-lg transition-colors">Bəli</button>
                  <button onClick={() => setClearConfirm(false)} className="text-xs font-semibold text-stone-600 border border-stone-200 hover:bg-stone-50 px-2.5 py-1 rounded-lg transition-colors">Xeyr</button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-bold text-stone-800">
                      {appendOrder ? 'Əlavə' : 'Sifariş'} {cartCount > 0 && <span className="text-primary-700">({cartCount})</span>}
                    </h2>
                    <p className="text-xs text-stone-500">{appendOrder ? `№${orderLabel(appendOrder)}-ə əlavə` : !tablesOn ? 'Yeni sifariş' : orderType === 'takeaway' ? 'Takeaway' : tableName(selectedTable)}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {cart.length > 0 && (
                      <button onClick={() => setClearConfirm(true)} className="w-8 h-8 flex items-center justify-center rounded-xl text-stone-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => { setMobileCartOpen(false); setClearConfirm(false); }} className="w-8 h-8 flex items-center justify-center rounded-xl bg-stone-100 text-stone-600">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {appendOrder
                ? <CartItems cart={cart} existingItems={appendOrder.items} removedItems={appendOrder.removedItems} addToCart={addToCart} removeFromCart={removeFromCart} onDecrementExisting={oi => handleDecrementItem(appendOrder, oi)} />
                : cart.length === 0
                ? <p className="text-center text-stone-500 text-sm py-8">Boşdur</p>
                : <CartItems cart={cart} addToCart={addToCart} removeFromCart={removeFromCart} />
              }
            </div>
            <div className="px-4 py-4 border-t space-y-3 bg-white shrink-0">
              <textarea
                placeholder="Qeyd..."
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={2}
                className="w-full text-sm border border-stone-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary-400"
              />
              <div className="flex justify-between items-center">
                <span className="text-sm text-stone-600">Cəmi:</span>
                <span className="font-bold text-xl text-primary-700">{cartTotal.toFixed(2)} ₼</span>
              </div>
              <button
                onClick={submitOrder}
                disabled={cart.length === 0 || submitting}
                className="w-full bg-primary-800 hover:bg-primary-900 disabled:bg-stone-300 text-white font-semibold py-4 rounded-2xl transition-colors text-base active:scale-95 flex items-center justify-center gap-2"
              >
                {submitting && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {submitting ? 'Göndərilir...' : appendOrder ? 'Əlavə et' : 'Sifariş ver'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Cancel order modal — bottom sheet on mobile */}
      {cancellingOrder && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-6 w-full sm:max-w-sm">
            <h3 className="font-bold text-lg text-stone-800 mb-1">Sifarişi ödənişsiz bağla</h3>
            <p className="text-sm text-stone-600 mb-4">
              №{orderLabel(cancellingOrder)}{tableName(cancellingOrder.tableNumber) && ` · ${tableName(cancellingOrder.tableNumber)}`} · {orderTotal(cancellingOrder).toFixed(2)} ₼
            </p>
            <p className="text-xs font-semibold text-stone-600 uppercase tracking-wide mb-2">Səbəb</p>
            <div className="flex flex-wrap gap-2 mb-4">
              {CANCEL_REASONS.map(r => (
                <button
                  key={r}
                  onClick={() => setCancelReason(r)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium border-2 transition-colors active:scale-95 ${cancelReason === r ? 'border-red-400 bg-red-50 text-red-600' : 'border-stone-200 text-stone-600 hover:border-stone-300'}`}
                >
                  {r}
                </button>
              ))}
            </div>
            {cancelReason === 'Digər' && (
              <input
                type="text" placeholder="Səbəbi yazın..."
                value={cancelOtherText}
                onChange={e => setCancelOtherText(e.target.value)}
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 mb-4"
                autoFocus
              />
            )}
            <div className="flex gap-2">
              <button onClick={() => setCancellingOrder(null)} className="flex-1 py-3 rounded-xl border border-stone-200 text-sm text-stone-600 hover:bg-stone-50">İmtina</button>
              <button
                onClick={confirmCancel}
                disabled={cancelBusy || !cancelReason || (cancelReason === 'Digər' && !cancelOtherText.trim())}
                className="flex-1 py-3 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-40 text-white font-semibold text-sm active:scale-95 transition-colors flex items-center justify-center gap-2"
              >
                {cancelBusy && <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                Ödənişsiz bağla
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Move-table modal — bottom sheet on mobile */}
      {movingOrder && (() => {
        const targetBusy = moveTarget !== null && tableHasActive(moveTarget, orders);
        return (
          <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
            <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-6 w-full sm:max-w-md">
              <h3 className="font-bold text-lg text-stone-800 mb-1">Masanı dəyiş</h3>
              <p className="text-sm text-stone-600 mb-4">
                №{orderLabel(movingOrder)} · {tableName(movingOrder.tableNumber)} · {orderTotal(movingOrder).toFixed(2)} ₼
              </p>
              <p className="text-xs font-semibold text-stone-600 uppercase tracking-wide mb-2">Yeni masa</p>
              <div className="flex flex-wrap gap-2 mb-4 max-h-56 overflow-y-auto">
                {tables.map(t => {
                  const busy = tableHasActive(t.id, orders);
                  const current = t.id === movingOrder.tableNumber;
                  const picked = moveTarget === t.id;
                  return (
                    <button
                      key={t.id}
                      disabled={current}
                      onClick={() => setMoveTarget(t.id)}
                      className={`px-4 py-2 rounded-xl text-sm font-medium border-2 transition-colors active:scale-95 disabled:opacity-40 disabled:active:scale-100 ${
                        picked
                          ? 'border-primary-500 bg-primary-50 text-primary-800'
                          : busy
                            ? 'border-red-200 bg-red-50 text-red-700 hover:border-red-300'
                            : 'border-stone-200 text-stone-600 hover:border-stone-300'
                      }`}
                    >
                      {t.name}
                      {halls.length > 1 && <span className="text-[10px] ml-1 text-stone-400">{hallName(t.hallId)}</span>}
                      {current && <span className="text-[10px] ml-1 opacity-70">(hazırkı)</span>}
                    </button>
                  );
                })}
              </div>
              {/* Two parties on one table is allowed — the floor plan already counts
                  open orders per table — but it should never happen by accident. */}
              {targetBusy && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">
                  {tableName(moveTarget)} məşğuldur — orada artıq açıq sifariş var. Yenə də köçürülsün?
                </p>
              )}
              <div className="flex gap-2">
                <button onClick={() => setMovingOrder(null)} className="flex-1 py-3 rounded-xl border border-stone-200 text-sm text-stone-600 hover:bg-stone-50">İmtina</button>
                <button
                  onClick={confirmMove}
                  disabled={moveBusy || !moveTarget}
                  className={`flex-1 py-3 rounded-xl disabled:opacity-40 text-white font-semibold text-sm active:scale-95 transition-colors flex items-center justify-center gap-2 ${targetBusy ? 'bg-red-500 hover:bg-red-600' : 'bg-primary-800 hover:bg-primary-900'}`}
                >
                  {moveBusy && <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                  {targetBusy ? 'Yenə də köçür' : 'Köçür'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Payment modal — bottom sheet on mobile */}
      {payingOrder && (() => {
        const fullTotal = orderTotal(payingOrder);
        const discountAmt = calcDiscount(fullTotal);
        const total = fullTotal - discountAmt;
        const cash = parseFloat(cashInput) || 0;
        const card = parseFloat(cardInput) || 0;
        const paid = cash + card;
        const missing = total - paid;
        const canPay = paid >= total;
        const overpay = Math.max(0, cash + card - total);
        const change = Math.min(overpay, cash);
        return (
          <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
            <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-6 w-full sm:max-w-sm">
              <h3 className="font-bold text-lg text-stone-800 mb-1">Ödəniş</h3>
              <p className="text-sm text-stone-600 mb-4">
                №{orderLabel(payingOrder)}{tableName(payingOrder.tableNumber) && ` · ${tableName(payingOrder.tableNumber)}`}
              </p>
              <ul className="text-sm space-y-2 mb-4 border-t pt-3 max-h-40 overflow-y-auto">
                {payingOrder.items.map((oi, i) => (
                  <li key={i} className="flex justify-between text-stone-700">
                    <div>
                      <span>{oi.menuItem.name} × {oi.quantity}</span>
                      {oi.modifiers && <p className="text-xs text-primary-600">{oi.modifiers}</p>}
                    </div>
                    <span className="shrink-0 ml-2">{(oi.menuItem.price * oi.quantity).toFixed(2)} ₼</span>
                  </li>
                ))}
              </ul>
              {/* Discount row */}
              <div className="flex items-center gap-2 mb-3">
                <div className="flex rounded-lg overflow-hidden border border-stone-200 shrink-0">
                  <button
                    onClick={() => setDiscountType('₼')}
                    className={`px-3 py-1.5 text-sm font-semibold transition-colors ${discountType === '₼' ? 'bg-primary-800 text-white' : 'bg-white text-stone-600'}`}
                  >₼</button>
                  <button
                    onClick={() => setDiscountType('%')}
                    className={`px-3 py-1.5 text-sm font-semibold transition-colors ${discountType === '%' ? 'bg-primary-800 text-white' : 'bg-white text-stone-600'}`}
                  >%</button>
                </div>
                <input
                  type="number" min="0" step="0.01" placeholder="Endirim..."
                  value={discountInput}
                  onChange={e => setDiscountInput(e.target.value)}
                  onFocus={e => e.target.select()}
                  className="flex-1 border border-stone-200 rounded-xl px-3 py-1.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary-700 text-center"
                />
                {discountAmt > 0 && (
                  <span className="text-sm font-bold text-green-600 shrink-0">-{discountAmt.toFixed(2)} ₼</span>
                )}
              </div>
              <div className="flex justify-between items-center font-bold text-xl border-t pt-3 mb-5">
                <span>Cəmi</span>
                <div className="text-right">
                  {discountAmt > 0 && <p className="text-xs text-stone-400 line-through font-normal">{fullTotal.toFixed(2)} ₼</p>}
                  <span className="text-primary-700">{total.toFixed(2)} ₼</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="text-xs font-medium text-stone-600 mb-1.5 flex items-center gap-1 block">💵 Nağd (₼)</label>
                  <input
                    type="number" min="0" step="0.01" placeholder="0.00"
                    value={cashInput}
                    onChange={e => setCashInput(e.target.value)}
                    onFocus={e => {
                      const el = e.target;
                      if (!(parseFloat(cashInput) || 0) && (parseFloat(cardInput) || 0) === total) {
                        setCardInput('');
                        setCashInput(total.toFixed(2));
                      }
                      requestAnimationFrame(() => el.select());
                    }}
                    className="w-full border border-stone-200 rounded-xl px-3 py-3 text-base font-semibold focus:outline-none focus:ring-2 focus:ring-primary-700 text-center"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-stone-600 mb-1.5 flex items-center gap-1 block">💳 Kart (₼)</label>
                  <input
                    type="number" min="0" step="0.01" placeholder="0.00"
                    value={cardInput}
                    onChange={e => setCardInput(e.target.value)}
                    onFocus={e => {
                      const el = e.target;
                      if (!(parseFloat(cardInput) || 0) && (parseFloat(cashInput) || 0) === total) {
                        setCashInput('');
                        setCardInput(total.toFixed(2));
                      }
                      requestAnimationFrame(() => el.select());
                    }}
                    className="w-full border border-stone-200 rounded-xl px-3 py-3 text-base font-semibold focus:outline-none focus:ring-2 focus:ring-primary-700 text-center"
                  />
                </div>
              </div>
              {paid > 0 && missing > 0 && (
                <div className="flex justify-between items-center px-4 py-3 rounded-xl font-semibold text-base mb-4 bg-red-50 text-red-600">
                  <span>Çatışmır</span>
                  <span>{missing.toFixed(2)} ₼</span>
                </div>
              )}
              {paid > 0 && change > 0 && (
                <div className="flex justify-between items-center px-4 py-3 rounded-xl font-semibold text-base mb-4 bg-green-50 text-green-700">
                  <span>💸 Qaytarılacaq</span>
                  <span>{change.toFixed(2)} ₼</span>
                </div>
              )}
              {paid > 0 && missing === 0 && overpay === 0 && (
                <div className="flex justify-between items-center px-4 py-3 rounded-xl font-semibold text-base mb-4 bg-green-50 text-green-700">
                  <span>Dəqiq ödəniş</span>
                  <span>✓</span>
                </div>
              )}
              {printerConnected ? (
                <button
                  onClick={() => { const next = !shouldPrintReceipt; setShouldPrintReceipt(next); setPrintReceiptEnabled(next); }}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl mb-3 text-sm font-semibold transition-colors ${shouldPrintReceipt ? 'bg-green-50 text-green-700' : 'bg-stone-100 text-stone-500'}`}
                >
                  <span>🖨️ Çek çap et</span>
                  <span>{shouldPrintReceipt ? '✓' : '—'}</span>
                </button>
              ) : (
                // Without this the toggle simply isn't there and the receipt never
                // comes out, with nothing on screen saying why. The cashier is the
                // one standing at the machine, so the pairing offer belongs here
                // rather than behind the admin panel.
                <button
                  onClick={async () => { setPrinterConnected(await selectPrinter()); }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl mb-3 text-sm font-semibold bg-stone-100 text-stone-500 hover:bg-stone-200 transition-colors"
                >
                  <Printer className="w-4 h-4" />Yazıcı seç
                </button>
              )}
              <div className="flex gap-2">
                <button onClick={() => setPayingOrder(null)} className="py-3 px-5 rounded-xl border border-stone-200 text-sm text-stone-600 hover:bg-stone-50">Ləğv et</button>
                <button
                  onClick={confirmPayment}
                  disabled={!canPay}
                  className="flex-1 py-3 rounded-xl bg-green-500 hover:bg-green-600 disabled:opacity-40 text-white font-semibold text-sm active:scale-95 transition-colors"
                >
                  Ödənildi ✓
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modifier modal — bottom sheet on mobile */}
      {modifierItem && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-6 w-full sm:max-w-sm">
            <h3 className="font-bold text-lg text-stone-800 mb-1">{modifierItem.name}</h3>
            <p className="text-sm text-stone-500 mb-4">Seçimləri edin</p>
            <div className="space-y-4 max-h-[55vh] overflow-y-auto">
              {(modifierItem.variants?.length ?? 0) > 0 && (
                <div>
                  <p className="text-xs font-semibold text-stone-600 uppercase tracking-wide mb-2">Variant</p>
                  <div className="flex flex-wrap gap-2">
                    {modifierItem.variants!.map(v => (
                      <button
                        key={v.id}
                        onClick={() => setSelectedVariant({ id: v.id, name: v.name, price: v.price })}
                        className={`px-4 py-2 rounded-xl text-sm font-medium border-2 transition-colors active:scale-95 ${selectedVariant?.id === v.id ? 'border-primary-800 bg-primary-50 text-primary-800' : 'border-stone-200 text-stone-600 hover:border-stone-300'}`}
                      >
                        {v.name} — {v.price.toFixed(2)} ₼
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {groupsForItem(modifierItem).map(group => {
                const picked = selectedMods[group.id] ?? [];
                return (
                  <div key={group.id}>
                    <p className="text-xs font-semibold text-stone-600 uppercase tracking-wide mb-2">
                      {group.name}
                      {group.minSelect > 0 && <span className="text-red-500 ml-1">*</span>}
                      {group.maxSelect !== 1 && <span className="text-stone-400 font-normal normal-case ml-1.5">(bir neçə seçim)</span>}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {group.options.map(opt => {
                        const on = picked.includes(opt.id);
                        return (
                          <button
                            key={opt.id}
                            onClick={() => toggleModOption(group, opt.id)}
                            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border-2 transition-colors active:scale-95 ${on ? 'border-primary-800 bg-primary-50 text-primary-800' : 'border-stone-200 text-stone-600 hover:border-stone-300'}`}
                          >
                            {opt.image && <img src={tillImage(opt.image)} alt="" className="w-6 h-6 rounded object-cover" />}
                            <span>{opt.name}</span>
                            {/* A 0 price is a free choice — showing "+0.00 ₼" would only add noise. */}
                            {opt.price > 0 && (
                              <span className={on ? 'text-primary-700' : 'text-stone-400'}>+{opt.price.toFixed(2)} ₼</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            {modifierDraft && (
              <p className="mt-4 text-sm text-stone-600 flex items-baseline justify-between">
                <span>Qiymət</span>
                <span className="text-lg font-bold text-stone-800">{modifierDraft.price.toFixed(2)} ₼</span>
              </p>
            )}
            <div className="flex gap-2 mt-4">
              <button onClick={() => { setModifierItem(null); setSelectedMods({}); }} className="flex-1 py-3 rounded-xl border border-stone-200 text-sm text-stone-600 hover:bg-stone-50">Ləğv et</button>
              <button
                onClick={confirmModifiers}
                disabled={modifierDraft?.missing}
                className="flex-1 py-3 rounded-xl bg-primary-800 hover:bg-primary-900 disabled:bg-stone-200 disabled:text-stone-400 text-white font-semibold text-sm active:scale-95 disabled:active:scale-100"
              >
                {modifierDraft?.missing ? 'Seçim edin' : 'Əlavə et'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ── CartItems — shared between desktop sidebar and mobile sheet ───────────

function CartItems({ cart, existingItems, removedItems, addToCart, removeFromCart, onDecrementExisting }: {
  cart: OrderItem[];
  existingItems?: OrderItem[];
  removedItems?: OrderItem[];
  addToCart: (item: MenuItem, mods?: string) => void;
  // price identifies the line: the same product with the same label can sit in the
  // cart at two prices if its set was re-priced between the two taps.
  removeFromCart: (itemId: string, mods?: string, price?: number) => void;
  onDecrementExisting?: (oi: OrderItem) => void;
}) {
  // Active items only — removed lines cost the guest nothing.
  const existingTotal = (existingItems ?? []).reduce((s, oi) => s + oi.menuItem.price * oi.quantity, 0);
  return (
    <div className="space-y-3">
      {existingItems && existingItems.length > 0 && (
        <div className="pb-3 mb-1 border-b border-stone-200">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Mövcud</p>
            <p className="text-xs font-semibold text-stone-500">{existingTotal.toFixed(2)} ₼</p>
          </div>
          <ul className="space-y-1.5">
            {existingItems.map((oi, j) => (
              <li key={'ex' + j} className="flex items-center justify-between gap-2 text-sm text-stone-500">
                <span className="flex-1 min-w-0 truncate">
                  {oi.menuItem.name}
                  {oi.modifiers && <span className="text-xs text-primary-600 ml-1">({oi.modifiers})</span>}
                </span>
                {onDecrementExisting && oi.id && (
                  <button
                    onClick={() => onDecrementExisting(oi)}
                    className="shrink-0 w-6 h-6 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-600 flex items-center justify-center active:scale-90"
                    title="Bir ədəd azalt"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                )}
                <span className="shrink-0 text-xs w-8 text-center">{oi.quantity} əd</span>
                <span className="shrink-0 w-14 text-right">{(oi.menuItem.price * oi.quantity).toFixed(2)} ₼</span>
              </li>
            ))}
            {/* Already taken off the order: shown, not hidden, but with no minus button
                and no price — it costs the guest nothing and isn't in existingTotal. */}
            {(removedItems ?? []).map((oi, j) => (
              <li key={'rm' + j} className="flex items-center justify-between gap-2 text-sm text-stone-400">
                <span className="flex-1 min-w-0 truncate line-through">
                  {oi.menuItem.name}
                  {oi.modifiers && <span className="text-xs ml-1">({oi.modifiers})</span>}
                </span>
                <span className="shrink-0 text-xs w-8 text-center line-through">{oi.quantity} əd</span>
                <span className="shrink-0 w-14 text-right text-[11px]">silindi</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {existingItems && cart.length === 0 && (
        <p className="text-center text-stone-400 text-xs py-2">Əlavə etmək üçün məhsul seçin</p>
      )}
    <ul className="space-y-3">
      {cart.map(ci => (
        <li key={ci.menuItem.id + (ci.modifiers ?? '') + ci.menuItem.price} className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-stone-800 truncate">{ci.menuItem.name}</p>
            {ci.modifiers && <p className="text-xs text-primary-600 truncate">{ci.modifiers}</p>}
            <p className="text-xs text-stone-500">{ci.menuItem.price.toFixed(2)} ₼</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => removeFromCart(ci.menuItem.id, ci.modifiers, ci.menuItem.price)}
              className="w-7 h-7 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-600 flex items-center justify-center active:scale-90"
            >
              <Minus className="w-3 h-3" />
            </button>
            <span className="w-5 text-center text-sm font-semibold">{ci.quantity}</span>
            <button
              onClick={() => addToCart(ci.menuItem, ci.modifiers)}
              className="w-7 h-7 rounded-full bg-primary-100 hover:bg-primary-200 text-primary-700 flex items-center justify-center active:scale-90"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </li>
      ))}
    </ul>
    </div>
  );
}

// How much of an order is on the counter. The count is what makes a green row
// actionable: "hazır" alone doesn't say whether to pick up the whole tray or one
// plate, and the waiter would have to open every green order to find out.
function ReadyBadge({ progress, allReady }: { progress: { done: number; total: number }; allReady: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${
      allReady ? 'bg-green-600 text-white' : 'bg-green-100 text-green-800 border border-green-300'
    }`}>
      {allReady ? '✓ Hamısı hazır' : `${progress.done}/${progress.total} hazır`}
    </span>
  );
}

// ── OrderRow — mobile card + desktop table row ────────────────────────────

function OrderRow({ order, tableLabel, tz, printFailed, progress, isItemReady, onReprint, onPay, onCancel, onAppend, onMove, onPrintBill, billBusy, onStatusChange }: {
  order: Order;
  tableLabel: string;
  tz: string;
  printFailed: boolean;
  progress: { done: number; total: number };
  isItemReady: (item: OrderItem) => boolean;
  onReprint: () => void;
  onPay: () => void;
  onCancel: () => void;
  onAppend: () => void;
  onMove: () => void;
  onPrintBill: () => void;
  billBusy: boolean;
  onStatusChange: (id: string, s: OrderStatus) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const total = orderTotal(order);
  const itemsPreview = order.items.map(oi =>
    oi.modifiers ? `${oi.menuItem.name} (${oi.modifiers})` : oi.menuItem.name
  ).join(', ');

  // Green is the only colour on this list, and it means one thing: food is waiting
  // to be carried. Partly green — some sexes done, some not — still calls the waiter
  // over, so both states are marked; only the strength differs.
  const anyReady = progress.done > 0;
  const allReady = progress.total > 0 && progress.done === progress.total;

  return (
    <div id={`order-${order.id}`}>
      {/* Mobile card, washed green end to end — a stripe on the edge was too quiet to
          catch from across the room. Pale, not saturated: the status pill and the red
          "bağla" button still have to read. */}
      <div className={`md:hidden mx-3 my-2 rounded-2xl border shadow-sm overflow-hidden ${anyReady ? 'bg-green-50 border-green-200 border-l-4 border-l-green-500' : 'bg-white border-stone-100'}`}>
        <button
          className="w-full p-4 text-left"
          onClick={() => setExpanded(e => !e)}
        >
          <div className="flex items-start justify-between mb-2">
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <ChevronDown className={`w-3.5 h-3.5 text-stone-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                <span className="text-primary-700 font-bold text-sm">№{orderLabel(order)}</span>
                {tableLabel && <span className="text-stone-800 font-semibold text-sm">{tableLabel}</span>}
              </div>
              <p className="text-xs text-stone-500 pl-5">
                {new Date(order.createdAt).toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit', timeZone: tz })} · {elapsed(order.createdAt)}
              </p>
            </div>
            <div className="text-right">
              <p className="font-bold text-stone-800">{total.toFixed(2)} ₼</p>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[order.status]}`}>{STATUS_LABELS[order.status]}</span>
            </div>
          </div>
          {anyReady && <ReadyBadge progress={progress} allReady={allReady} />}
          {!expanded && <p className="text-xs text-stone-600 truncate">{itemsPreview}</p>}
        </button>

        {/* The kitchen never got this ticket. The waiter has to know — a slip that
            vanishes in silence is worse than having no printer at all. */}
        {printFailed && (
          <div className="mx-4 mb-3 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
            <p className="flex-1 text-xs text-red-700 font-medium">Sexə çıxmadı — printer cavab vermir</p>
            <button
              onClick={onReprint}
              className="shrink-0 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white px-2.5 py-1 rounded-md transition-colors"
            >
              Yenidən çap
            </button>
          </div>
        )}

        {expanded && (
          <div className={`px-4 pb-4 border-t border-stone-100 ${anyReady ? 'bg-green-50/70' : 'bg-stone-50'}`}>
            <div className="pt-3 mb-3">
              <OrderItemHistory order={order} tz={tz} isItemReady={isItemReady} />
            </div>
            {order.note && <p className="text-xs text-stone-500 italic mb-3">Qeyd: {order.note}</p>}
            {(order.discountAmount ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-lg px-2 py-0.5 mb-3">
                🏷️ -{order.discountAmount!.toFixed(2)} ₼ endirim
              </span>
            )}
            {isOrderOpen(order) && (
              <div className="flex flex-col gap-2 pt-1">
                <button
                  onClick={e => { e.stopPropagation(); onPay(); }}
                  className="w-full bg-primary-800 hover:bg-primary-900 active:scale-95 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-all"
                >
                  Ödəniş
                </button>
                {/* The bill the customer sees, printed while the order is still
                    open — the paper between the kitchen ticket and the receipt. */}
                <button
                  onClick={e => { e.stopPropagation(); onPrintBill(); }}
                  disabled={billBusy}
                  className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-emerald-300 text-emerald-700 hover:bg-emerald-50 active:scale-95 disabled:opacity-50 text-sm font-semibold transition-all"
                >
                  <Printer className="w-4 h-4" />{billBusy ? 'Çap olunur…' : 'Çap et'}
                </button>
                <button
                  onClick={e => { e.stopPropagation(); onAppend(); }}
                  className="w-full px-4 py-2.5 rounded-xl border border-primary-300 text-primary-800 hover:bg-primary-50 active:scale-95 text-sm font-semibold transition-all"
                >
                  Düzəliş et
                </button>
                {order.tableNumber !== 0 && (
                  <button
                    onClick={e => { e.stopPropagation(); onMove(); }}
                    className="w-full px-4 py-2.5 rounded-xl border border-stone-300 text-stone-700 hover:bg-stone-100 active:scale-95 text-sm font-semibold transition-all"
                  >
                    Masanı dəyiş
                  </button>
                )}
                <button
                  onClick={e => { e.stopPropagation(); onCancel(); }}
                  className="w-full px-4 py-2.5 rounded-xl border border-red-200 text-red-500 hover:bg-red-50 active:scale-95 text-sm font-semibold transition-all"
                >
                  Ödənişsiz bağla
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Desktop table row. Keeps a hover of its own — a green row that doesn't
          react under the cursor looks disabled. */}
      <div className={`hidden md:block border-b ${anyReady ? 'bg-green-50 hover:bg-green-100 border-l-4 border-l-green-500' : 'bg-white hover:bg-stone-50'}`}>
        <div
          className="w-full grid grid-cols-[120px_1fr_140px_200px_110px] gap-4 px-6 py-4 items-center cursor-pointer"
          onClick={() => setExpanded(e => !e)}
        >
          <div>
            <p className="font-semibold text-stone-800 text-sm">
              {new Date(order.createdAt).toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit', timeZone: tz })}
            </p>
            <p className="text-xs text-stone-500">{elapsed(order.createdAt)}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-stone-800 flex items-center gap-1">
              <ChevronDown className={`w-3.5 h-3.5 text-stone-400 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
              <span className="text-primary-700">№{orderLabel(order)}</span>{tableLabel && <>{' › '}<span>{tableLabel}</span></>}
            </p>
            {!expanded && <p className="text-xs text-stone-500 truncate max-w-xs pl-5">{itemsPreview}</p>}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[order.status]}`}>
              {STATUS_LABELS[order.status]}
            </span>
            {anyReady && <ReadyBadge progress={progress} allReady={allReady} />}
            {printFailed && (
              <span title="Sexə çıxmadı — printer cavab vermir" className="flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full">
                <AlertTriangle className="w-3 h-3" /> Çap
              </span>
            )}
          </div>
          <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
            {printFailed && (
              <button onClick={onReprint} className="bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors whitespace-nowrap">
                Yenidən çap
              </button>
            )}
            {isOrderOpen(order) && (
              <>
                <button onClick={onPay} className="bg-primary-800 hover:bg-primary-900 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors whitespace-nowrap">
                  Ödəniş
                </button>
                <button onClick={onCancel} className="border border-red-200 text-red-500 hover:bg-red-50 text-xs font-semibold px-3 py-1.5 rounded transition-colors whitespace-nowrap">
                  Ödənişsiz bağla
                </button>
              </>
            )}
          </div>
          <div className="text-right">
            {(order.discountAmount ?? 0) > 0 && (
              <p className="text-xs text-stone-400 line-through leading-tight">{(total + order.discountAmount!).toFixed(2)} ₼</p>
            )}
            <span className="font-bold text-stone-800">{total.toFixed(2)} ₼</span>
            {(order.discountAmount ?? 0) > 0 && (
              <p className="text-xs text-green-600 font-semibold leading-tight">-{order.discountAmount!.toFixed(2)} ₼</p>
            )}
          </div>
        </div>

        {expanded && (
          <div className={`px-6 pb-4 border-t border-stone-100 ${anyReady ? 'bg-green-50/70' : 'bg-stone-50'}`}>
            <div className="pt-3 mb-3">
              <OrderItemHistory order={order} tz={tz} isItemReady={isItemReady} />
            </div>
            {order.note && <p className="text-xs text-stone-500 italic">Qeyd: {order.note}</p>}
            {isOrderOpen(order) && (
              <div className="flex gap-2 pt-3 mt-1 border-t border-stone-200">
                <button
                  onClick={e => { e.stopPropagation(); onPrintBill(); }}
                  disabled={billBusy}
                  className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 border border-emerald-300 hover:bg-emerald-50 disabled:opacity-50 rounded-lg px-3 py-1.5 transition-colors"
                >
                  <Printer className="w-3.5 h-3.5" />{billBusy ? 'Çap olunur…' : 'Çap et'}
                </button>
                <button
                  onClick={e => { e.stopPropagation(); onAppend(); }}
                  className="text-xs font-semibold text-primary-800 border border-primary-300 hover:bg-primary-50 rounded-lg px-3 py-1.5 transition-colors"
                >
                  Düzəliş et
                </button>
                {order.tableNumber !== 0 && (
                  <button
                    onClick={e => { e.stopPropagation(); onMove(); }}
                    className="text-xs font-semibold text-stone-700 border border-stone-300 hover:bg-stone-100 rounded-lg px-3 py-1.5 transition-colors"
                  >
                    Masanı dəyiş
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

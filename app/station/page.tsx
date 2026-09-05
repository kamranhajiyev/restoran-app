'use client';

// The prep screen ("sex"). One employee, one sex, only the food that sex makes.
//
// Deliberately not the seller page with things hidden: a cook needs the four facts
// on a card from two metres away — what, how many, which table, how long ago — and
// nothing else. No totals, no payment, no menu.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CircleCheck, Check, Settings } from 'lucide-react';
import { getSession, logout, validateSession, clearLocalSession, homeFor } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import {
  setCompanyContext, fetchMenu, fetchOrders, fetchStations,
  fetchStationReady, markStationReady, unmarkStationReady, StationReady,
} from '@/lib/store';
import { menuIndex, sliceForStation, readyStationIds } from '@/lib/stations';
import { itemBatches } from '@/lib/order-items';
import { snapshotOrders, diffOrderAlerts, OrdersSnapshot } from '@/lib/orderAlerts';
import { unlockSound, playNewOrder, playItemRemoved } from '@/lib/sound';
import { MenuItem, Order, OrderItem, Station, isOrderOpen } from '@/types';

// A card older than this is late. Newest-first puts the oldest at the BOTTOM, so
// the colour is what stops it being forgotten — the sort can't be relied on to
// surface it.
const LATE_MS = 15 * 60 * 1000;
// Re-renders the waiting times. Nothing else would: a quiet realtime channel means
// a card's clock would otherwise freeze at whatever it said when it arrived.
const CLOCK_MS = 10 * 1000;

// Card text size, in px, for the whole card: everything inside is sized in `em`, so
// this one number drives it. Older cooks read the screen from further away than the
// person who signed off on the design ever did — and the eyes differ cook to cook,
// so the choice belongs to the device, not the company.
const FONT_PX = [16, 20, 25] as const;
const FONT_LABELS = ['Normal', 'Böyük', 'Ən böyük'] as const;

// Kept in localStorage rather than on the staff row: the kitchen tablet is fixed to
// one wall and regularly offline, so a device-local write always lands where a
// network one would not. Keyed by employee anyway, for the tablet two cooks share.
const fontKey = (userId: string) => `stationFont:${userId}`;

function loadFontLevel(userId: string): number {
  try {
    const level = Number(localStorage.getItem(fontKey(userId)));
    return Number.isInteger(level) && level >= 0 && level < FONT_PX.length ? level : 0;
  } catch { return 0; } // private mode
}

function saveFontLevel(userId: string, level: number) {
  try { localStorage.setItem(fontKey(userId), String(level)); } catch { /* private mode */ }
}
// Big text in four columns is worse than big text in two. Widen the cards as the
// type grows rather than letting every dish name wrap.
const FONT_GRID = [
  'sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4',
  'sm:grid-cols-2 xl:grid-cols-3',
  'lg:grid-cols-2',
] as const;

// When this sex's clock on a card starts: the oldest thing it still has to make,
// not the order's own age. After "Hazırdır" the card only comes back for items
// added later, and those have waited seconds — an hour-old order number must not
// stamp them "gecikir" the moment they land.
function waitingSince(
  slice: { items: OrderItem[]; removedItems: OrderItem[] },
  createdAt: string,
): string {
  let oldestMs = Infinity;
  let oldestISO = createdAt;
  for (const item of [...slice.items, ...slice.removedItems]) {
    // No createdAt belongs to the original order — the same stand-in
    // itemBatches and sliceForStation use for pre-migration rows.
    const iso = item.createdAt ?? createdAt;
    const ms = Date.parse(iso);
    if (!Number.isNaN(ms) && ms < oldestMs) { oldestMs = ms; oldestISO = iso; }
  }
  return oldestISO;
}

function waitedLabel(fromISO: string, now: number): string {
  const mins = Math.floor((now - Date.parse(fromISO)) / 60000);
  if (!Number.isFinite(mins) || mins < 1) return 'indicə';
  if (mins < 60) return `${mins} dəq`;
  const h = Math.floor(mins / 60);
  return `${h} saat ${mins % 60} dəq`;
}

function clockTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit' });
}

export default function StationPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [station, setStation] = useState<Station | null>(null);
  const [employeeName, setEmployeeName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [readyRows, setReadyRows] = useState<StationReady[]>([]);
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [fontLevel, setFontLevel] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const refreshOrders = useCallback(async () => {
    const [o, r] = await Promise.all([
      fetchOrders({ limit: 200 }),
      fetchStationReady(),
    ]);
    setOrders(o);
    setReadyRows(r);
    setOnline(true);
  }, []);

  // ── Session guard ───────────────────────────────────────────────────────────
  useEffect(() => {
    const session = getSession();
    if (!session) { router.replace('/login'); return; }
    if (session.role !== 'employee') { router.replace(homeFor(session)); return; }
    // The sex was deleted out from under them (FK is ON DELETE SET NULL), so there
    // is nothing to filter by and the screen would be blank and unexplained.
    if (!session.stationId) { router.replace('/no-station'); return; }

    setEmployeeName(session.name);
    setEmployeeId(session.id);
    // In the effect, not in useState: the server has no localStorage, and reading it
    // during render would hydrate the first paint at the wrong size.
    setFontLevel(loadFontLevel(session.id));
    setCompanyContext(session.companyId);

    validateSession(session).then(valid => {
      if (!valid) { logout(); router.replace('/login'); return; }
      // validateSession re-reads station_id — an owner may have moved them mid-shift.
      const fresh = getSession();
      if (!fresh?.stationId) { router.replace('/no-station'); return; }
      if (fresh.stationId !== session.stationId) { router.refresh(); return; }
    });

    const { data: authSub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!s || s.user.id !== session.id) { clearLocalSession(); router.replace('/login'); }
    });

    Promise.all([fetchMenu(), fetchOrders({ limit: 200 }), fetchStations(), fetchStationReady()])
      .then(([m, o, st, r]) => {
        setMenu(m);
        setOrders(o);
        setStations(st);
        setReadyRows(r);
        setStation(st.find(s => s.id === session.stationId) ?? null);
        setOnline(true);
        setReady(true);
      })
      .catch(() => { setOnline(false); setReady(true); });

    return () => { authSub.subscription.unsubscribe(); };
  }, [router]);

  // ── Realtime ────────────────────────────────────────────────────────────────
  // Filtered by company_id, unlike the older seller/admin channels: a screen in
  // every sex of every venue makes unfiltered replication expensive, and the filter
  // costs nothing to add now.
  const [realtimeUp, setRealtimeUp] = useState(false);
  const [rtAttempt, setRtAttempt] = useState(0);
  const companyId = getSession()?.companyId ?? null;

  useEffect(() => {
    if (!companyId) return;
    const channel = supabase
      .channel(`station-${companyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `company_id=eq.${companyId}` }, () => refreshOrders())
      // order_items has no company_id of its own — it hangs off the order — so this
      // one cannot be filtered. RLS still scopes what actually arrives.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => refreshOrders())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_station_ready', filter: `company_id=eq.${companyId}` }, () => refreshOrders())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items', filter: `company_id=eq.${companyId}` }, () => { fetchMenu().then(setMenu); })
      .subscribe(status => setRealtimeUp(status === 'SUBSCRIBED'));
    return () => { setRealtimeUp(false); supabase.removeChannel(channel); };
  }, [companyId, refreshOrders, rtAttempt]);

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

  // Seatbelt for a dead socket. Food nobody was told to cook is the one failure
  // this screen cannot have.
  useEffect(() => {
    if (realtimeUp) return;
    const id = setInterval(() => {
      if (document.visibilityState !== 'hidden') refreshOrders();
    }, 15000);
    return () => clearInterval(id);
  }, [realtimeUp, refreshOrders]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(id);
  }, []);

  // ── This sex's work ─────────────────────────────────────────────────────────
  const menuById = useMemo(() => menuIndex(menu), [menu]);
  const stationId = station?.id ?? null;

  // Orders this sex has genuinely finished. Not just "a ready row exists": if the
  // waiter added another beer after we said done, the card has to come back or that
  // beer is never made.
  const readySet = useMemo(() => {
    if (!stationId) return new Set<string>();
    const done = new Set<string>();
    for (const o of orders) {
      if (readyStationIds(o, readyRows, menuById, stations).has(stationId)) done.add(o.id);
    }
    return done;
  }, [orders, readyRows, stationId, menuById, stations]);

  // An open order, sliced down to this sex, that this sex hasn't finished yet.
  const cards = useMemo(() => {
    if (!stationId) return [];
    return orders
      .filter(o => isOrderOpen(o))
      .filter(o => !readySet.has(o.id))
      // This sex's last ready_at on this order, if any — the cutoff that hides
      // the batch it already made when a later addition re-opens the card.
      .map(o => {
        const readyAt = readyRows.find(
          r => r.orderId === o.id && r.stationId === stationId,
        )?.readyAt ?? null;
        const slice = sliceForStation(o, stationId, menuById, stations, readyAt);
        return { order: o, ...slice, since: waitingSince(slice, o.createdAt) };
      })
      // Nothing of ours on this order — it belongs to another sex entirely.
      .filter(c => c.items.length > 0 || c.removedItems.length > 0)
      // Newest first, as asked — by when THIS sex's pending work arrived, so a
      // re-opened old order sorts with its new dish rather than by its number.
      // The waiting time and the late colour are what keep an old card at the
      // bottom from being forgotten.
      .sort((a, b) => Date.parse(b.since) - Date.parse(a.since));
  }, [orders, readySet, readyRows, stationId, menuById, stations]);

  // ── Sound ───────────────────────────────────────────────────────────────────
  // Same diff the seller uses, fed the station-filtered list: the pizza screen must
  // never beep for a beer.
  const [soundReady, setSoundReady] = useState(false);
  const seen = useRef<OrdersSnapshot | null>(null);
  // This screen's own taps are the only thing it changes, and marking ready removes
  // the card rather than adding work — so there is nothing to mute here.
  useEffect(() => {
    const snapshot = snapshotOrders(cards.map(c => ({ id: c.order.id, items: c.items })));
    const prev = seen.current;
    seen.current = snapshot;
    if (!prev) return;                 // first paint — don't chime the backlog
    if (!soundReady) return;
    const { newWork, removed } = diffOrderAlerts(prev, snapshot);
    if (newWork) playNewOrder().then(ok => { if (!ok) setSoundReady(false); });
    if (removed) playItemRemoved(newWork ? 450 : 0).then(ok => { if (!ok) setSoundReady(false); });
  }, [cards, soundReady]);

  async function enableSound() {
    setSoundReady(await unlockSound());
  }

  // Same as the seller screen: returning after a lock / app-switch is when iOS has
  // killed the audio engine, so re-arm it as soon as the tab is visible again
  // rather than letting the next order's beep be the thing that discovers it's dead.
  // Only worth doing once sound has been armed at least once on this device.
  useEffect(() => {
    if (!soundReady) return;
    const rearm = () => {
      if (document.visibilityState === 'visible') unlockSound().then(setSoundReady);
    };
    window.addEventListener('focus', rearm);
    document.addEventListener('visibilitychange', rearm);
    return () => {
      window.removeEventListener('focus', rearm);
      document.removeEventListener('visibilitychange', rearm);
    };
  }, [soundReady]);

  async function onReady(orderId: string) {
    if (!stationId || busyId) return;
    setBusyId(orderId);
    // Optimistic: the card must go the instant it's tapped, or a cook taps twice.
    const optimistic: StationReady = { orderId, stationId, readyAt: new Date().toISOString(), readyBy: employeeName };
    setReadyRows(rows => [...rows, optimistic]);
    const err = await markStationReady(orderId, stationId, employeeName);
    setBusyId(null);
    if (err) {
      setReadyRows(rows => rows.filter(r => !(r.orderId === orderId && r.stationId === stationId)));
      setOnline(false);
      return;
    }
    // Tell any backgrounded waiter, whose page cannot make a sound — only a pushed OS
    // notification reaches a locked phone or a hidden tab. Fire-and-forget: a failed
    // push must never block or undo the readiness the cook just recorded.
    notifyWaiters(orderId);
  }

  async function notifyWaiters(orderId: string) {
    const order = orders.find(o => o.id === orderId);
    const where = order?.tableNumber ? `Masa ${order.tableNumber}` : 'Sifariş';
    const num = order ? ` #${order.orderNumber}` : '';
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch('/api/notify-ready', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          orderId,
          title: `${where}${num} hazırdır`,
          body: `${station?.name ?? 'Sex'} sifarişi hazır etdi`,
        }),
      });
    } catch { /* the on-screen green badge is still the source of truth */ }
  }

  async function onUndo(orderId: string) {
    if (!stationId) return;
    await unmarkStationReady(orderId, stationId);
    refreshOrders();
  }

  // The last order this screen marked ready, for an undo that costs one tap.
  const [lastDone, setLastDone] = useState<{ id: string; number: number } | null>(null);
  useEffect(() => {
    if (!lastDone) return;
    const t = setTimeout(() => setLastDone(null), 8000);
    return () => clearTimeout(t);
  }, [lastDone]);

  if (!ready) {
    return <div className="min-h-screen grid place-items-center bg-[#f7f3ed] text-stone-500">Yüklənir…</div>;
  }

  return (
    <div className="min-h-screen bg-[#f7f3ed] text-stone-800 flex flex-col">
      <header className="flex items-center justify-between gap-3 px-4 py-3 bg-white border-b border-stone-100 sticky top-0 z-10">
        <div className="min-w-0">
          <h1 className="text-xl font-bold truncate">{station?.name ?? 'Sex'}</h1>
          <p className="text-xs text-stone-500 truncate">{employeeName}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSettingsOpen(true)}
            aria-label="Tənzimləmələr"
            className="p-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-600 transition-colors active:scale-95"
          >
            <Settings className="w-5 h-5" />
          </button>
          {!online &&<span className="text-xs px-2 py-1 rounded-lg bg-red-100 text-red-600">Bağlantı yoxdur</span>}
          {!realtimeUp && online && <span className="text-xs px-2 py-1 rounded-lg bg-stone-100 text-stone-500">Yenilənir…</span>}
          <span className="text-sm tabular-nums px-2 py-1 rounded-lg bg-stone-100 text-stone-600">{cards.length}</span>
          <button
            onClick={() => setLogoutConfirm(true)}
            className="text-xs px-3 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-600 transition-colors active:scale-95"
          >
            Çıxış
          </button>
        </div>
      </header>

      {!soundReady && (
        // WebAudio needs a real gesture; without this the screen is silently mute.
        <button
          onClick={enableSound}
          className="mx-4 mt-3 px-4 py-3 rounded-xl bg-primary-800 hover:bg-primary-900 text-white text-sm font-semibold transition-colors active:scale-95 flex items-center justify-center gap-2"
        >
          <Bell className="w-4 h-4" />
          Səsi aktivləşdir
        </button>
      )}

      {lastDone && (
        <div className="mx-4 mt-3 flex items-center justify-between gap-3 px-4 py-2 rounded-xl bg-white border border-stone-100 text-sm">
          <span className="text-stone-600">#{lastDone.number} hazır göndərildi</span>
          <button onClick={() => { onUndo(lastDone.id); setLastDone(null); }} className="font-semibold text-primary-800 hover:text-primary-900">
            Geri al
          </button>
        </div>
      )}

      <main className="flex-1 p-4">
        {cards.length === 0 ? (
          // Empty is the good state: it means caught up, not broken.
          <div className="h-full grid place-items-center text-center py-20">
            <div>
              <CircleCheck className="w-10 h-10 mx-auto mb-3 text-stone-300" />
              <p className="text-sm text-stone-500">Hazırlanacaq yemək yoxdur</p>
            </div>
          </div>
        ) : (
          <div className={`grid gap-4 ${FONT_GRID[fontLevel]}`}>
            {cards.map(card => (
              <StationCard
                key={card.order.id}
                order={card.order}
                items={card.items}
                removedItems={card.removedItems}
                since={card.since}
                now={now}
                fontPx={FONT_PX[fontLevel]}
                busy={busyId === card.order.id}
                onReady={() => { onReady(card.order.id); setLastDone({ id: card.order.id, number: card.order.orderNumber }); }}
              />
            ))}
          </div>
        )}
      </main>

      {settingsOpen && (
        // Tapping the backdrop closes it: the way out must not depend on finding a
        // small × — the same eyes that need the big type have to be able to leave.
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => setSettingsOpen(false)}
        >
          <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl p-5 w-full max-w-sm">
            <h2 className="text-lg font-bold mb-1">Tənzimləmələr</h2>
            <p className="text-sm text-stone-500 mb-4">Yazı ölçüsü</p>

            <div className="space-y-2">
              {FONT_PX.map((px, i) => (
                // Each row is set in the size it selects — the choice is previewed, not
                // described, so nothing has to be read to be understood.
                <button
                  key={px}
                  onClick={() => { setFontLevel(i); saveFontLevel(employeeId, i); }}
                  aria-pressed={fontLevel === i}
                  className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border-2 text-left transition-colors ${
                    fontLevel === i
                      ? 'border-primary-800 bg-primary-50'
                      : 'border-stone-200 hover:bg-stone-50'
                  }`}
                >
                  <span className="flex items-baseline gap-3 min-w-0">
                    <span className="font-bold text-stone-800 w-8 shrink-0" style={{ fontSize: px }}>A</span>
                    <span className="font-semibold text-stone-700 truncate" style={{ fontSize: px }}>
                      {FONT_LABELS[i]}
                    </span>
                  </span>
                  {fontLevel === i && <Check className="w-6 h-6 shrink-0 text-primary-800" />}
                </button>
              ))}
            </div>

            <button
              onClick={() => setSettingsOpen(false)}
              className="mt-5 w-full py-3 rounded-xl bg-primary-800 hover:bg-primary-900 text-white font-bold transition-colors active:scale-95"
            >
              Bağla
            </button>
          </div>
        </div>
      )}

      {logoutConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-xs text-center">
            <p className="mb-5">Çıxış etmək istəyirsiniz?</p>
            <div className="flex gap-2">
              <button onClick={() => setLogoutConfirm(false)} className="flex-1 py-2.5 rounded-xl border border-stone-200 text-sm font-semibold text-stone-600 hover:bg-stone-50 transition-colors">Ləğv et</button>
              <button onClick={() => { logout(); router.replace('/login'); }} className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition-colors">Çıxış</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Everything below is sized in `em` against the card's own font-size, so the header's
// A / A / A picker moves the type, the padding and the gaps together. Nothing here is
// px — one fixed size in the middle of an em layout is what makes big text look broken.
function StationCard({
  order, items, removedItems, since, now, busy, fontPx, onReady,
}: {
  order: Order;
  items: OrderItem[];
  removedItems: OrderItem[];
  since: string;
  now: number;
  busy: boolean;
  fontPx: number;
  onReady: () => void;
}) {
  const waitedMs = now - Date.parse(since);
  const late = waitedMs > LATE_MS;

  // Reuse the seller's batching so the card reads as a history: the original order,
  // then each "Əlavə et" at its own time, with removals folded in where they happened.
  // A partial removal's ghost row surfaces at the moment it was taken away.
  const batches = useMemo(
    () => itemBatches({ items, removedItems, createdAt: order.createdAt }),
    [items, removedItems, order.createdAt],
  );

  // Everything this sex had was taken off. The card stays until it's acknowledged —
  // vanishing silently is how a cook keeps making food nobody ordered.
  const allRemoved = items.length === 0;

  return (
    <div
      style={{ fontSize: fontPx }}
      className={`rounded-2xl border-2 flex flex-col ${
        allRemoved ? 'bg-stone-50 border-stone-200'
        : late ? 'bg-red-50 border-red-400'
        : 'bg-white border-stone-100'
      }`}
    >
      {/* The table is what a cook actually calls out and what the waiter comes back
          for; the order number is a receipt detail nobody cooks from. So the table
          is the headline and the number is the small print — it used to be reversed. */}
      <div className="flex items-baseline justify-between gap-[0.5em] px-[1em] pt-[0.75em]">
        <span className="text-[1.5em] font-bold leading-tight truncate">
          {order.tableNumber ? `Masa ${order.tableNumber}` : 'Özü ilə'}
        </span>
        <span className="text-[0.8em] text-stone-400 tabular-nums shrink-0">#{order.orderNumber}</span>
      </div>

      {/* Always visible: newest-first only works if an old card still shouts. */}
      {/* The size lives on the inner span: an `em` padding on a resized element would
          resolve against that new size and pull the card's left edge out of line. */}
      <div className="px-[1em] pb-[0.5em]">
        <span className={`text-[0.75em] font-semibold ${late ? 'text-red-600' : 'text-stone-500'}`}>
          {waitedLabel(since, now)}{late ? ' · gecikir' : ''}
        </span>
      </div>

      <div className="px-[1em] pb-[0.75em] flex-1 space-y-[0.75em]">
        {batches.map((batch, i) => (
          <div key={batch.at}>
            {!batch.isFirst && (
              // A later addition, timestamped: "this came in after the rest".
              <div className="text-[0.6875em] font-semibold text-primary-800 mb-[0.4em]">
                + Əlavə · {clockTime(batch.at)}
              </div>
            )}
            <ul className="space-y-[0.375em]">
              {batch.items.map((item, j) => (
                <li key={item.id ?? `${i}-${j}`} className="flex items-start gap-[0.6em] text-[0.875em]">
                  {/* A filled badge, not "2×" in the same ink as the dish. How many is
                      the number a cook gets wrong from across the room, and a count
                      that reads as part of the name is the way that happens. */}
                  <span className={`shrink-0 min-w-[1.9em] text-center rounded-lg px-[0.25em] py-[0.1em] text-[1.15em] font-bold tabular-nums leading-snug ${
                    item.removedAt ? 'bg-stone-200 text-stone-400' : 'bg-stone-800 text-white'
                  }`}>
                    {item.quantity}
                  </span>
                  <span className={`leading-snug ${item.removedAt ? 'line-through text-stone-400' : 'font-semibold'}`}>
                    {item.menuItem.name}
                    {item.modifiers && (
                      <span className="block text-[0.857em] text-stone-500">{item.modifiers}</span>
                    )}
                    {item.removedAt && (
                      // Struck through AND timestamped — never silently gone.
                      <span className="block text-[0.857em] text-red-600">
                        ləğv edildi · {clockTime(item.removedAt)}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {/* The note is an instruction to the cook, not a footnote — same size as a
            dish line, never smaller. It was the smallest text on the card before. */}
        {order.note && (
          <p className="text-[0.875em] font-medium bg-amber-50 rounded-lg px-[0.6em] py-[0.45em] text-amber-800">{order.note}</p>
        )}
      </div>

      <button
        onClick={onReady}
        disabled={busy}
        className={`m-[0.75em] mt-0 py-[0.75em] rounded-xl text-[1em] font-bold disabled:opacity-50 transition-colors active:scale-95 ${
          allRemoved
            ? 'bg-stone-200 hover:bg-stone-300 text-stone-700'
            : 'bg-primary-800 hover:bg-primary-900 text-white'
        }`}
      >
        {allRemoved ? 'Anladım' : 'Hazırdır'}
      </button>
    </div>
  );
}

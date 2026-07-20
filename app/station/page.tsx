'use client';

// The prep screen ("sex"). One employee, one sex, only the food that sex makes.
//
// Deliberately not the seller page with things hidden: a cook needs the four facts
// on a card from two metres away — what, how many, which table, how long ago — and
// nothing else. No totals, no payment, no menu.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CircleCheck } from 'lucide-react';
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
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [readyRows, setReadyRows] = useState<StationReady[]>([]);
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [logoutConfirm, setLogoutConfirm] = useState(false);

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
      .map(o => ({ order: o, ...sliceForStation(o, stationId, menuById, stations) }))
      // Nothing of ours on this order — it belongs to another sex entirely.
      .filter(c => c.items.length > 0 || c.removedItems.length > 0)
      // Newest first, as asked. The waiting time and the late colour are what keep
      // an old card at the bottom from being forgotten.
      .sort((a, b) => Date.parse(b.order.createdAt) - Date.parse(a.order.createdAt));
  }, [orders, readySet, stationId, menuById, stations]);

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
    }
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
          {!online && <span className="text-xs px-2 py-1 rounded-lg bg-red-100 text-red-600">Bağlantı yoxdur</span>}
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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {cards.map(card => (
              <StationCard
                key={card.order.id}
                order={card.order}
                items={card.items}
                removedItems={card.removedItems}
                now={now}
                busy={busyId === card.order.id}
                onReady={() => { onReady(card.order.id); setLastDone({ id: card.order.id, number: card.order.orderNumber }); }}
              />
            ))}
          </div>
        )}
      </main>

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

function StationCard({
  order, items, removedItems, now, busy, onReady,
}: {
  order: Order;
  items: OrderItem[];
  removedItems: OrderItem[];
  now: number;
  busy: boolean;
  onReady: () => void;
}) {
  const waitedMs = now - Date.parse(order.createdAt);
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
    <div className={`rounded-2xl border-2 flex flex-col ${
      allRemoved ? 'bg-stone-50 border-stone-200'
      : late ? 'bg-red-50 border-red-400'
      : 'bg-white border-stone-100'
    }`}>
      <div className="flex items-baseline justify-between gap-2 px-4 pt-3">
        <span className="text-lg font-bold">#{order.orderNumber}</span>
        <span className="text-sm text-stone-500">
          {order.tableNumber ? `Masa ${order.tableNumber}` : 'Özü ilə'}
        </span>
      </div>

      {/* Always visible: newest-first only works if an old card still shouts. */}
      <div className={`px-4 pb-2 text-xs font-semibold ${late ? 'text-red-600' : 'text-stone-500'}`}>
        {waitedLabel(order.createdAt, now)}{late ? ' · gecikir' : ''}
      </div>

      <div className="px-4 pb-3 flex-1 space-y-3">
        {batches.map((batch, i) => (
          <div key={batch.at}>
            {!batch.isFirst && (
              // A later addition, timestamped: "this came in after the rest".
              <div className="text-[11px] font-semibold text-primary-800 mb-1">
                + Əlavə · {clockTime(batch.at)}
              </div>
            )}
            <ul className="space-y-1.5">
              {batch.items.map((item, j) => (
                <li key={item.id ?? `${i}-${j}`} className="flex gap-2 text-sm">
                  <span className={`font-bold tabular-nums ${item.removedAt ? 'text-stone-400' : 'text-stone-800'}`}>
                    {item.quantity}×
                  </span>
                  <span className={item.removedAt ? 'line-through text-stone-400' : ''}>
                    {item.menuItem.name}
                    {item.modifiers && (
                      <span className="block text-xs text-stone-500">{item.modifiers}</span>
                    )}
                    {item.removedAt && (
                      // Struck through AND timestamped — never silently gone.
                      <span className="block text-xs text-red-600">
                        ləğv edildi · {clockTime(item.removedAt)}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {order.note && (
          <p className="text-xs bg-amber-50 rounded-lg px-2 py-1.5 text-amber-800">{order.note}</p>
        )}
      </div>

      <button
        onClick={onReady}
        disabled={busy}
        className={`m-3 mt-0 py-3 rounded-xl font-bold disabled:opacity-50 transition-colors active:scale-95 ${
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

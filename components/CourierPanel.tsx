'use client';

// Kuryerlər — the owner's side of courier debt.
//
// Three views of the same money: who the couriers are and what each is holding,
// the log of every handover with the seller who took it, and a date-ranged
// report. Settlement itself is deliberately absent: cash comes off a courier at
// the counter, where a drawer is open to put it in and a shift to account for
// it. An owner accepting money here would book it into no drawer at all.

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Pencil, Trash2, Bike, Wallet, BarChart2 } from 'lucide-react';
import {
  fetchCouriers, createCourier, updateCourier, deleteCourier,
  fetchCourierLedger, fetchCourierOutstanding, fetchCourierPaymentLog,
} from '@/lib/store';
import { Courier, CourierLedger, CourierPayment } from '@/types';
import { DialogState } from '@/components/AppDialog';
import { inputCls, btnPrimary, btnGhost, Modal } from '@/components/panel-ui';
import { CompanySettings, businessToday, businessDayStartUtc, addDays } from '@/lib/business-day';

type Sub = 'couriers' | 'payments' | 'report';

const SUBS: { id: Sub; label: string; icon: React.ElementType }[] = [
  { id: 'couriers', label: 'Kuryerlər', icon: Bike },
  { id: 'payments', label: 'Ödənişlər', icon: Wallet },
  { id: 'report', label: 'Hesabat', icon: BarChart2 },
];

export default function CourierPanel({ setDialog, bizSettings }: {
  setDialog: (d: DialogState | null) => void;
  bizSettings: CompanySettings;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const subParam = searchParams.get('sub');
  const sub: Sub = SUBS.some(x => x.id === subParam) ? (subParam as Sub) : 'couriers';
  function setSub(s: Sub) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', 'couriers');
    params.set('sub', s);
    router.replace(`/admin?${params.toString()}`);
  }

  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2200); }
  function fail(msg: string | null) { if (msg) setDialog({ title: 'Xəta', message: msg }); }

  async function reload() { setCouriers(await fetchCouriers()); setLoaded(true); }
  useEffect(() => { reload(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {SUBS.map(s => {
          const Icon = s.icon;
          const on = sub === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setSub(s.id)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-sm rounded-lg font-medium transition-colors ${
                on ? 'bg-stone-800 text-white' : 'border border-stone-200 text-stone-600 hover:bg-stone-50'
              }`}
            >
              <Icon className="w-4 h-4" />{s.label}
            </button>
          );
        })}
      </div>

      {!loaded ? (
        <div className="text-sm text-stone-400 py-10 text-center">Yüklənir…</div>
      ) : (
        <>
          {sub === 'couriers' && <CouriersTab couriers={couriers} reload={reload} flash={flash} fail={fail} setDialog={setDialog} />}
          {sub === 'payments' && <PaymentsTab couriers={couriers} />}
          {sub === 'report' && <ReportTab couriers={couriers} bizSettings={bizSettings} />}
        </>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-stone-800 text-white text-sm px-4 py-2 rounded-lg shadow-lg z-[110]">
          {toast}
        </div>
      )}
    </div>
  );
}

// ─── Kuryerlər ────────────────────────────────────────────────────────────────

function CouriersTab({ couriers, reload, flash, fail, setDialog }: {
  couriers: Courier[]; reload: () => Promise<void>; flash: (m: string) => void;
  fail: (m: string | null) => void; setDialog: (d: DialogState | null) => void;
}) {
  const [editing, setEditing] = useState<Courier | 'new' | null>(null);
  const [f, setF] = useState({ name: '', phone: '', active: true });
  const [busy, setBusy] = useState(false);
  const [balance, setBalance] = useState<Record<string, number>>({});

  useEffect(() => { fetchCourierOutstanding().then(setBalance); }, [couriers]);

  function open(c: Courier | 'new') {
    setEditing(c);
    setF(c === 'new' ? { name: '', phone: '', active: true } : { name: c.name, phone: c.phone ?? '', active: c.active });
  }

  async function save() {
    if (!f.name.trim()) return;
    setBusy(true);
    const err = editing === 'new'
      ? await createCourier(f.name.trim(), f.phone)
      : await updateCourier((editing as Courier).id, f.name.trim(), f.phone, f.active);
    setBusy(false);
    if (err) { fail(/duplicate|unique/.test(err) ? 'Bu adda kuryer artıq var.' : err); return; }
    setEditing(null); await reload(); flash('Yadda saxlanıldı');
  }

  function remove(c: Courier) {
    setDialog({
      title: 'Kuryeri sil?', message: `«${c.name}» silinəcək.`, onConfirm: async () => {
        const err = await deleteCourier(c.id);
        // orders.courier_id is `on delete restrict`, so a courier who has ever
        // carried anything cannot be removed — the history would rewrite itself.
        // Deactivation is the answer, and the message has to say so.
        if (err) {
          fail(/foreign|violates/.test(err)
            ? 'Bu kuryerin sifarişləri var — silinə bilməz. Əvəzinə deaktiv edin.'
            : err);
        } else { await reload(); flash('Silindi'); }
      },
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-stone-400">Kuryer pulu satıcıya təhvil verir — kassadan qeydə alınır.</p>
        <button className={btnPrimary} onClick={() => open('new')}><Plus className="w-4 h-4" /> Yeni kuryer</button>
      </div>
      <div className="bg-white rounded-2xl border border-stone-100 divide-y divide-stone-100">
        {couriers.length === 0 && <p className="text-sm text-stone-400 p-6 text-center">Kuryer yoxdur</p>}
        {couriers.map(c => {
          const owed = balance[c.id] ?? 0;
          return (
            <div key={c.id} className="flex items-center justify-between px-4 py-3 gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-stone-800">
                  {c.name} {!c.active && <span className="text-xs text-stone-400">(deaktiv)</span>}
                </div>
                {c.phone && <div className="text-xs text-stone-400">{c.phone}</div>}
                <div className="text-xs mt-0.5">
                  {owed > 0.005
                    ? <span className="text-red-500">Borc: <b className="tabular-nums">{owed.toFixed(2)} ₼</b></span>
                    : owed < -0.005
                    // Paid more than they owed, because an order they had already
                    // settled came back. The restaurant owes them the difference.
                    ? <span className="text-blue-600">Ona qaytarılmalı: <b className="tabular-nums">{Math.abs(owed).toFixed(2)} ₼</b></span>
                    : <span className="text-emerald-600">Borc yoxdur</span>}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <button className={btnGhost} onClick={() => open(c)}><Pencil className="w-3.5 h-3.5" /></button>
                <button className={btnGhost} onClick={() => remove(c)}><Trash2 className="w-3.5 h-3.5 text-red-500" /></button>
              </div>
            </div>
          );
        })}
      </div>

      {editing && (
        <Modal title={editing === 'new' ? 'Yeni kuryer' : 'Kuryeri düzəlt'} onClose={() => setEditing(null)}>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-stone-500 mb-1">Ad</label>
              <input className={inputCls} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} autoFocus />
            </div>
            <div>
              <label className="block text-xs text-stone-500 mb-1">Telefon</label>
              <input className={inputCls} value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} />
            </div>
            {editing !== 'new' && (
              <label className="flex items-center gap-2 text-sm text-stone-600">
                <input type="checkbox" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} /> Aktiv
              </label>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button className={btnGhost} onClick={() => setEditing(null)}>Ləğv et</button>
            <button className={btnPrimary} onClick={save} disabled={busy || !f.name.trim()}>Yadda saxla</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Ödənişlər ────────────────────────────────────────────────────────────────

function PaymentsTab({ couriers }: { couriers: Courier[] }) {
  const [rows, setRows] = useState<CourierPayment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [courierId, setCourierId] = useState('');
  useEffect(() => { fetchCourierPaymentLog().then(r => { setRows(r); setLoaded(true); }); }, []);

  const visible = useMemo(
    () => (courierId ? rows.filter(p => p.courierId === courierId) : rows),
    [rows, courierId],
  );
  const total = useMemo(() => visible.reduce((s, p) => s + p.amount, 0), [visible]);

  if (!loaded) return <div className="text-sm text-stone-400 py-10 text-center">Yüklənir…</div>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-stone-400">Kuryerlərin təhvil verdiyi bütün pullar — kim qəbul edib.</p>
        <div className="flex items-center gap-2">
          <select value={courierId} onChange={e => setCourierId(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border border-stone-200 focus:outline-none focus:ring-2 focus:ring-stone-300">
            <option value="">Bütün kuryerlər</option>
            {couriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <span className="text-sm text-stone-500">Cəmi: <b className="tabular-nums text-emerald-600">{total.toFixed(2)} ₼</b></span>
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-stone-100 divide-y divide-stone-100">
        {visible.length === 0 && <p className="text-sm text-stone-400 p-6 text-center">Ödəniş yoxdur</p>}
        {visible.map(p => (
          <div key={p.id} className="flex items-start justify-between px-4 py-3 gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-stone-800">{p.courierName}</div>
              <div className="text-xs text-stone-400">
                {new Date(p.createdAt).toLocaleString('az-AZ')}
                {/* The whole point of the column: who was standing at the till. */}
                {p.createdBy ? <> · Qəbul edən: <span className="text-stone-500">{p.createdBy}</span></> : ''}
              </div>
            </div>
            <span className="text-sm font-semibold tabular-nums text-emerald-600 shrink-0">{p.amount.toFixed(2)} ₼</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Hesabat ──────────────────────────────────────────────────────────────────

type ReportPreset = 'bugün' | '7g' | '30g' | 'ay';

function presetRange(p: ReportPreset, today: string): [string, string] {
  const toStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const [y, m, d] = today.split('-').map(Number);
  const from = new Date(y, m - 1, d);
  if (p === '7g') from.setDate(from.getDate() - 6);
  else if (p === '30g') from.setDate(from.getDate() - 29);
  else if (p === 'ay') from.setDate(1);
  return [toStr(from), today];
}

function ReportTab({ couriers, bizSettings }: { couriers: Courier[]; bizSettings: CompanySettings }) {
  const today = businessToday(bizSettings);
  const [preset, setPreset] = useState<ReportPreset>('30g');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [ledger, setLedger] = useState<Record<string, CourierLedger>>({});
  const [loading, setLoading] = useState(true);

  const valid = !!(customFrom && customTo && customFrom <= customTo);
  const [from, to] = valid ? [customFrom, customTo] : presetRange(preset, today);

  useEffect(() => {
    setLoading(true);
    // Business days, not calendar days — a restaurant closing at 03:00 books
    // those sales on the day the shift started. The upper bound is the start of
    // the following business day, and the query is exclusive there.
    fetchCourierLedger({
      from: businessDayStartUtc(from, bizSettings).toISOString(),
      to: businessDayStartUtc(addDays(to, 1), bizSettings).toISOString(),
    }).then(l => { setLedger(l); setLoading(false); });
  }, [from, to, bizSettings]);

  const names = useMemo(
    () => Object.fromEntries(couriers.map(c => [c.id, c.name])) as Record<string, string>,
    [couriers],
  );
  const rows = useMemo(
    () => Object.entries(ledger)
      .map(([id, l]) => ({ id, name: names[id] ?? '—', ...l }))
      .sort((a, b) => b.delivered - a.delivered),
    [ledger, names],
  );
  const totals = rows.reduce(
    (s, r) => ({ orders: s.orders + r.orders, delivered: s.delivered + r.delivered, paid: s.paid + r.paid, outstanding: s.outstanding + Math.max(0, r.outstanding) }),
    { orders: 0, delivered: 0, paid: 0, outstanding: 0 },
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 bg-stone-50 border border-stone-200 rounded-lg p-2">
        {(['bugün', '7g', '30g', 'ay'] as ReportPreset[]).map(p => (
          <button
            key={p}
            onClick={() => { setPreset(p); setCustomFrom(''); setCustomTo(''); }}
            className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
              !valid && preset === p ? 'bg-stone-800 text-white' : 'text-stone-600 hover:bg-stone-100'
            }`}
          >
            {p === 'bugün' ? 'Bugün' : p === 'ay' ? 'Bu ay' : p === '7g' ? '7 gün' : '30 gün'}
          </button>
        ))}
        <span className="text-xs text-stone-400 px-1">və ya</span>
        <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
          className="px-2 py-1.5 text-xs rounded-lg border border-stone-200 focus:outline-none focus:ring-2 focus:ring-stone-300" />
        <span className="text-xs text-stone-400">—</span>
        <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
          className="px-2 py-1.5 text-xs rounded-lg border border-stone-200 focus:outline-none focus:ring-2 focus:ring-stone-300" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Sifariş', value: String(totals.orders), tone: 'text-stone-800' },
          { label: 'Çatdırılıb', value: `${totals.delivered.toFixed(2)} ₼`, tone: 'text-stone-800' },
          { label: 'Ödənilib', value: `${totals.paid.toFixed(2)} ₼`, tone: 'text-emerald-600' },
          { label: 'Cari borc', value: `${totals.outstanding.toFixed(2)} ₼`, tone: 'text-red-600' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-2xl border border-stone-100 p-4">
            <p className="text-xs text-stone-400 mb-1">{k.label}</p>
            <p className={`text-lg font-bold tabular-nums ${k.tone}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Said plainly, because the columns will not add up otherwise: two of them
          are scoped to the range and one is not. */}
      <p className="text-xs text-stone-400">
        «Çatdırılıb» və «Ödənilib» seçilmiş tarix aralığına aiddir. «Cari borc» isə kuryerin
        bu günə qədərki ümumi borcudur — aralıqdan asılı deyil.
      </p>

      {loading ? (
        <div className="text-sm text-stone-400 py-10 text-center">Yüklənir…</div>
      ) : (
        <div className="bg-white rounded-2xl border border-stone-100 overflow-x-auto">
          {rows.length === 0 ? (
            <p className="text-sm text-stone-400 p-6 text-center">Bu aralıqda kuryer sifarişi yoxdur</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-stone-400 border-b border-stone-100">
                  <th className="text-left font-medium px-4 py-2.5">Kuryer</th>
                  <th className="text-right font-medium px-4 py-2.5">Sifariş</th>
                  <th className="text-right font-medium px-4 py-2.5">Çatdırılıb</th>
                  <th className="text-right font-medium px-4 py-2.5">Ödənilib</th>
                  <th className="text-right font-medium px-4 py-2.5">Cari borc</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {rows.map(r => (
                  <tr key={r.id}>
                    <td className="px-4 py-2.5 text-stone-800">{r.name}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-stone-500">{r.orders}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-stone-700">{r.delivered.toFixed(2)} ₼</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-emerald-600">{r.paid.toFixed(2)} ₼</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${
                      r.outstanding > 0.005 ? 'text-red-600' : r.outstanding < -0.005 ? 'text-blue-600' : 'text-stone-400'
                    }`}>
                      {r.outstanding.toFixed(2)} ₼
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

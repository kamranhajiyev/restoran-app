'use client';

// Sifariş növləri: which order types the till offers and how each one moves
// the menu prices (lib/order-types), saved in companies.order_types.
import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2, Armchair, ShoppingBag, Bike, Tag, QrCode } from 'lucide-react';
import { fetchOrderTypes, saveOrderTypes } from '@/lib/store';
import {
  asksForTable, changeLabel, NO_CHANGE, orderTypeProblem, typedPrice, withSwitches,
  type OrderType, type PriceChange,
} from '@/lib/order-types';
import type { Hall, RestaurantTable } from '@/types';
import OrderTypeQr from './OrderTypeQr';

const ICONS: Record<string, React.ElementType> = { masa: Armchair, takeaway: ShoppingBag, delivery: Bike };

type Form = { id: string; name: string; needsTable: boolean; sign: 1 | -1; amount: string; unit: 'azn' | '%' };

const blank = (): Form => ({ id: `t${Date.now()}`, name: '', needsTable: false, sign: 1, amount: '', unit: '%' });

function formToChange(form: Form): PriceChange {
  const amount = form.amount.trim() ? Number(form.amount.replace(',', '.')) : 0;
  return amount ? { sign: form.sign, amount, unit: form.unit } : NO_CHANGE;
}

// A round 10 ₼ makes the change easy to read: +5% is 10.50 ₼. A real dish
// could be a 1 ₼ Fanta, where 5% looks like nothing.
const SAMPLE_PRICE = 10;

/** "10.00 ₼ → 10.50 ₼". */
function sampleText(change: PriceChange) {
  return <>{SAMPLE_PRICE.toFixed(2)} ₼ → <span className="font-semibold text-stone-700">{typedPrice(SAMPLE_PRICE, change).toFixed(2)} ₼</span></>;
}

export default function OrderTypesPanel({ tablesOn, deliveryOn, onTablesOn, onDeliveryOn, slug, tables, halls }: {
  tablesOn: boolean;
  deliveryOn: boolean;
  /** For the QR links; no QR button until it is known. */
  slug: string | null;
  tables: RestaurantTable[];
  halls: Hall[];
  /** The Masalar and Kuryerlər switches: Masa and Çatdırılma have no switch of their own. */
  onTablesOn: (on: boolean) => void;
  onDeliveryOn: (on: boolean) => void;
}) {
  const [saved, setSaved] = useState<OrderType[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [qrFor, setQrFor] = useState<OrderType | null>(null);

  // A failed read stays "not loaded": every save writes the whole list, so
  // editing on top of a failure would wipe the owner's real types.
  function load() {
    setLoadError(false);
    fetchOrderTypes().then(t => { if (t) setSaved(t); else setLoadError(true); });
  }
  useEffect(load, []);

  const types = saved ? withSwitches(saved, { tablesOn, deliveryOn }) : [];

  async function update(next: OrderType[]) {
    const before = saved;
    setSaved(next);
    setSaving(true);
    setSaveError('');
    const err = await saveOrderTypes(next);
    setSaving(false);
    if (err) { setSaved(before); setSaveError('Yadda saxlanmadı, yenidən cəhd edin'); }
  }

  function toggle(t: OrderType) {
    if (t.builtIn === 'masa') return onTablesOn(!t.on);
    if (t.builtIn === 'delivery') return onDeliveryOn(!t.on);
    void update(types.map(x => x.id === t.id ? { ...x, on: !x.on } : x));
  }

  function edit(t: OrderType) {
    setError('');
    setForm({ id: t.id, name: t.name, needsTable: t.needsTable, sign: t.change.sign, amount: t.change.amount ? String(t.change.amount) : '', unit: t.change.unit });
  }

  function save() {
    if (!form) return;
    const change = formToChange(form);
    const problem = orderTypeProblem({ id: form.id, name: form.name, change }, types);
    if (problem) { setError(problem); return; }
    const existing = types.find(t => t.id === form.id);
    const edited: OrderType = existing
      ? { ...existing, name: form.name.trim(), needsTable: existing.builtIn ? existing.needsTable : form.needsTable, change }
      : { id: form.id, name: form.name.trim(), on: true, needsTable: form.needsTable, change };
    void update(existing ? types.map(t => t.id === edited.id ? edited : t) : [...types, edited]);
    setForm(null);
  }

  const formChange = form ? formToChange(form) : NO_CHANGE;
  const editingBuiltIn = !!form && !!types.find(t => t.id === form.id)?.builtIn;

  return (
    <div className="max-w-3xl space-y-4">
      <div className="bg-white rounded-xl border border-stone-100">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-stone-100 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-stone-700">Sifariş növləri</p>
            <p className="text-xs text-stone-500">Satıcı “Yeni sifariş”də aktiv olanları görür. Qiymət dəyişikliyi menyudakı hər məhsula tətbiq olunur.</p>
          </div>
          <button disabled={!saved || saving} onClick={() => { setError(''); setForm(blank()); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-800 text-white text-sm font-semibold hover:bg-primary-900 disabled:opacity-50">
            <Plus className="w-4 h-4" />Əlavə et
          </button>
        </div>

        {!saved && (
          <p className="text-sm text-stone-400 py-6 text-center">
            {loadError ? <button onClick={load} className="text-primary-700 font-semibold">Yüklənmədi — yenidən cəhd et</button> : 'Yüklənir…'}
          </p>
        )}
        {saveError && <p className="text-xs text-red-500 px-4 pt-3">{saveError}</p>}
        <div className="divide-y divide-stone-100">
          {types.map(t => {
            const Icon = (t.builtIn && ICONS[t.builtIn]) || Tag;
            const label = changeLabel(t.change);
            return (
              <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${t.on ? 'bg-stone-100 text-stone-700' : 'bg-stone-50 text-stone-300'}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${t.on ? 'text-stone-800' : 'text-stone-400'}`}>
                    {t.name}
                    {label && (
                      <span className={`ml-2 px-1.5 py-0.5 rounded text-xs font-semibold ${t.change.sign > 0 ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'}`}>{label}</span>
                    )}
                  </p>
                  <p className="text-xs text-stone-500">
                    {asksForTable(t, tablesOn) ? 'Masa seçilir' : t.needsTable ? 'Masasız (Masalar deaktivdir)' : 'Masasız'}
                    {label && <> · {sampleText(t.change)}</>}
                  </p>
                </div>
                {slug && t.on && (
                  <button onClick={() => setQrFor(t)} title="QR kod — bu növün qiymətləri ilə menyu" className="p-1.5 text-stone-400 hover:text-stone-700"><QrCode className="w-4 h-4" /></button>
                )}
                <button onClick={() => edit(t)} title="Düzəliş" className="p-1.5 text-stone-400 hover:text-stone-700"><Pencil className="w-4 h-4" /></button>
                {!t.builtIn && (
                  confirmDelete === t.id ? (
                    <button disabled={saving} onClick={() => { void update(types.filter(x => x.id !== t.id)); setConfirmDelete(null); }}
                      className="text-xs font-semibold text-red-600 px-1.5">Sil?</button>
                  ) : (
                    <button onClick={() => setConfirmDelete(t.id)} title="Sil" className="p-1.5 text-stone-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                  )
                )}
                <button
                  disabled={saving}
                  onClick={() => toggle(t)}
                  title={t.on ? 'Kassada görünür' : 'Kassada görünmür'}
                  className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-60 ${t.on ? 'bg-primary-800' : 'bg-stone-300'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${t.on ? 'translate-x-5' : ''}`} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {qrFor && slug && (
        <OrderTypeQr type={qrFor} slug={slug} tables={tables} halls={halls} tablesOn={tablesOn} onClose={() => setQrFor(null)} />
      )}

      {form && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={() => setForm(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <p className="text-base font-semibold text-stone-800">{types.some(t => t.id === form.id) ? 'Sifariş növünə düzəliş' : 'Yeni sifariş növü'}</p>

            <label className="block space-y-1">
              <span className="text-xs font-semibold text-stone-500">Ad</span>
              <input id="order-type-name" autoFocus value={form.name} placeholder="Məs. Banket"
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-primary-600" />
            </label>

            {/* One decision per row: up or down, then how much. */}
            <div className="space-y-2">
              <span className="text-xs font-semibold text-stone-500">Qiymət dəyişikliyi</span>
              <div className="grid grid-cols-2 gap-0.5 bg-stone-100 rounded-lg p-0.5">
                {([1, -1] as const).map(s => (
                  <button key={s} onClick={() => setForm({ ...form, sign: s })}
                    className={`py-2 rounded-md text-sm font-semibold transition-colors ${form.sign !== s ? 'text-stone-500 hover:text-stone-700' : s > 0 ? 'bg-amber-500 text-white shadow-sm' : 'bg-green-600 text-white shadow-sm'}`}>
                    {s > 0 ? 'Artır' : 'Endirim'}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input id="order-type-amount" inputMode="decimal" value={form.amount} placeholder="0"
                  onChange={e => setForm({ ...form, amount: e.target.value })}
                  className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-stone-200 text-sm text-right focus:outline-none focus:border-primary-600" />
                <div className="grid grid-cols-2 gap-0.5 bg-stone-100 rounded-lg p-0.5 w-28 shrink-0">
                  {(['%', 'azn'] as const).map(u => (
                    <button key={u} onClick={() => setForm({ ...form, unit: u })}
                      className={`rounded-md text-sm font-semibold ${form.unit === u ? 'bg-white shadow-sm text-stone-800' : 'text-stone-500 hover:text-stone-700'}`}>
                      {u === '%' ? '%' : '₼'}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-stone-500 bg-stone-50 rounded-lg px-3 py-2">
                {formChange.amount ? <>Hər məhsula. Nümunə: {sampleText(formChange)}</> : 'Boş qoysanız qiymətlər dəyişmir.'}
              </p>
            </div>

            {!editingBuiltIn && (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className={`text-sm font-medium ${tablesOn ? 'text-stone-800' : 'text-stone-400'}`}>Masa seçilsin</p>
                  <p className="text-xs text-stone-500">
                    {tablesOn ? 'Açıq: əvvəl zal və masa açılır. Bağlı: birbaşa menyu.' : 'Masalar deaktivdir (Masalar bölməsi). Bu növ birbaşa menyunu açacaq.'}
                  </p>
                </div>
                <button disabled={!tablesOn} onClick={() => setForm({ ...form, needsTable: !form.needsTable })}
                  className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${asksForTable(form, tablesOn) ? 'bg-primary-800' : 'bg-stone-300'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${asksForTable(form, tablesOn) ? 'translate-x-5' : ''}`} />
                </button>
              </div>
            )}

            {error && <p className="text-xs text-red-500">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setForm(null)} className="px-4 py-2 rounded-lg text-sm font-semibold text-stone-600 hover:bg-stone-100">Ləğv et</button>
              <button onClick={save} className="px-4 py-2 rounded-lg bg-primary-800 text-white text-sm font-semibold hover:bg-primary-900">Yadda saxla</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

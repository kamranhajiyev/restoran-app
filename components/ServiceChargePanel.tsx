'use client';

// Xidmət haqqı: the percent added on top of an order and the order types it
// applies to (lib/service-charge), saved in companies.service_charge.
import { useEffect, useState } from 'react';
import { Armchair, ShoppingBag, Bike, Tag, Check } from 'lucide-react';
import { fetchSaleSettings, saveServiceCharge } from '@/lib/store';
import { withSwitches, type OrderType } from '@/lib/order-types';
import { serviceAmount, serviceChargeProblem, type ServiceCharge } from '@/lib/service-charge';

const ICONS: Record<string, React.ElementType> = { masa: Armchair, takeaway: ShoppingBag, delivery: Bike };

// A round 100 ₼ makes the percent easy to read: 8% is 108 ₼.
const SAMPLE_TOTAL = 100;

type Form = { on: boolean; percent: string; typeIds: string[] };

const toForm = (sc: ServiceCharge): Form => ({ on: sc.on, percent: sc.percent ? String(sc.percent) : '', typeIds: sc.typeIds });
const fromForm = (f: Form): ServiceCharge => ({
  on: f.on,
  percent: f.percent.trim() ? Number(f.percent.replace(',', '.')) : 0,
  typeIds: f.typeIds,
});

export default function ServiceChargePanel({ tablesOn, deliveryOn }: { tablesOn: boolean; deliveryOn: boolean }) {
  const [saved, setSaved] = useState<ServiceCharge | null>(null);
  const [types, setTypes] = useState<OrderType[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  // A failed read stays "not loaded", so saving can never write over the real setting.
  function load() {
    setLoadError(false);
    fetchSaleSettings().then(s => {
      if (!s) { setLoadError(true); return; }
      setSaved(s.serviceCharge);
      setForm(toForm(s.serviceCharge));
      setTypes(s.types);
    });
  }
  useEffect(load, []);

  const shown = types ? withSwitches(types, { tablesOn, deliveryOn }) : [];
  const next = form ? fromForm(form) : null;
  const changed = !!next && !!saved && JSON.stringify(next) !== JSON.stringify(saved);

  async function save() {
    if (!next) return;
    const problem = serviceChargeProblem(next);
    if (problem) { setError(problem); return; }
    setSaving(true);
    setError('');
    const err = await saveServiceCharge(next);
    setSaving(false);
    if (err) { setError('Yadda saxlanmadı, yenidən cəhd edin'); return; }
    setSaved(next);
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  }

  function edit(patch: Partial<Form>) {
    if (!form) return;
    setForm({ ...form, ...patch });
    setError('');
    setDone(false);
  }

  const percent = next?.percent ?? 0;

  return (
    <div className="max-w-3xl space-y-4">
      <div className="bg-white rounded-xl border border-stone-100">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-stone-100">
          <div>
            <p className="text-sm font-semibold text-stone-700">Xidmət haqqı</p>
            <p className="text-xs text-stone-500">Sifarişin məbləğinə faiz əlavə olunur və müştəri hesabında ayrıca sətirlə görünür.</p>
          </div>
          <button
            disabled={!form || saving}
            onClick={() => form && edit({ on: !form.on })}
            title={form?.on ? 'Aktivdir' : 'Deaktivdir'}
            className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-60 ${form?.on ? 'bg-primary-800' : 'bg-stone-300'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form?.on ? 'translate-x-5' : ''}`} />
          </button>
        </div>

        {!form && (
          <p className="text-sm text-stone-400 py-6 text-center">
            {loadError ? <button onClick={load} className="text-primary-700 font-semibold">Yüklənmədi — yenidən cəhd et</button> : 'Yüklənir…'}
          </p>
        )}

        {form && (
          <div className={`p-4 space-y-5 ${form.on ? '' : 'opacity-50'}`}>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-stone-500">Faiz</span>
              <div className="flex items-center gap-2 max-w-xs">
                <input id="service-charge-percent" inputMode="decimal" value={form.percent} placeholder="0"
                  disabled={!form.on}
                  onChange={e => edit({ percent: e.target.value })}
                  className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-stone-200 text-sm text-right focus:outline-none focus:border-primary-600" />
                <span className="text-sm font-semibold text-stone-500">%</span>
              </div>
              <p className="text-xs text-stone-500 bg-stone-50 rounded-lg px-3 py-2 max-w-xs">
                {percent > 0
                  ? <>Nümunə: {SAMPLE_TOTAL.toFixed(2)} ₼ + {serviceAmount(SAMPLE_TOTAL, percent).toFixed(2)} ₼ = <span className="font-semibold text-stone-700">{(SAMPLE_TOTAL + serviceAmount(SAMPLE_TOTAL, percent)).toFixed(2)} ₼</span></>
                  : 'Faiz yazın, məs. 8'}
              </p>
            </label>

            <div className="space-y-1">
              <span className="text-xs font-semibold text-stone-500">Hansı sifarişlərə</span>
              <div className="divide-y divide-stone-100 border border-stone-100 rounded-lg">
                {shown.map(t => {
                  const Icon = (t.builtIn && ICONS[t.builtIn]) || Tag;
                  const picked = form.typeIds.includes(t.id);
                  return (
                    <button key={t.id} disabled={!form.on}
                      onClick={() => edit({ typeIds: picked ? form.typeIds.filter(id => id !== t.id) : [...form.typeIds, t.id] })}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-stone-50 disabled:hover:bg-transparent">
                      <span className={`w-5 h-5 rounded flex items-center justify-center shrink-0 border ${picked ? 'bg-primary-800 border-primary-800 text-white' : 'border-stone-300'}`}>
                        {picked && <Check className="w-3.5 h-3.5" />}
                      </span>
                      <Icon className={`w-4 h-4 shrink-0 ${t.on ? 'text-stone-600' : 'text-stone-300'}`} />
                      <span className={`text-sm ${t.on ? 'text-stone-800' : 'text-stone-400'}`}>{t.name}</span>
                      {!t.on && <span className="text-xs text-stone-400">(deaktiv)</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {form && (
          <div className="flex items-center justify-end gap-3 px-4 py-3 border-t border-stone-100">
            {error && <p className="text-xs text-red-500 mr-auto">{error}</p>}
            {done && <p className="text-xs text-green-600 font-semibold">Yadda saxlanıldı</p>}
            <button disabled={!changed || saving} onClick={save}
              className="px-4 py-2 rounded-lg bg-primary-800 text-white text-sm font-semibold hover:bg-primary-900 disabled:opacity-50">
              {saving ? 'Saxlanılır…' : 'Yadda saxla'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

// Əməkdaşlar → İcazələr: what each role may do on the till (lib/till-rules).
import { useEffect, useState } from 'react';
import { KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { fetchTillRules, saveTillRules } from '@/lib/store';
import { ROLE_NAMES, TILL_ACTIONS, TILL_RULES_NEW, ruleFor, type Rule, type RuledRole, type TillAction, type TillRules } from '@/lib/till-rules';
import type { Staff } from '@/types';

const ROLES: RuledRole[] = ['seller', 'waiter'];

const RULES: { id: Rule; label: string; icon: React.ElementType; on: string }[] = [
  { id: 'free', label: 'Sərbəst',   icon: ShieldCheck, on: 'bg-white shadow-sm text-green-700' },
  { id: 'pin',  label: 'Admin PIN', icon: KeyRound,    on: 'bg-white shadow-sm text-amber-700' },
  { id: 'deny', label: 'Qadağan',   icon: Lock,        on: 'bg-white shadow-sm text-red-700' },
];

export default function TillRulesPanel({ staff }: { staff: Staff[] }) {
  const [rules, setRules] = useState<TillRules | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [role, setRole] = useState<RuledRole>('seller');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // A failed read stays "not loaded": every save writes the whole set, so
  // editing on top of a failure would wipe the owner's real rules.
  function load() {
    setError('');
    fetchTillRules().then(r => {
      if (r === undefined) { setError('İcazələr yüklənmədi'); return; }
      setRules(r);
      setLoaded(true);
    });
  }
  useEffect(load, []);

  async function save(next: TillRules) {
    const before = rules;
    setRules(next);
    setSaving(true);
    setError('');
    const err = await saveTillRules(next);
    setSaving(false);
    if (err) { setRules(before); setError('Yadda saxlanmadı, yenidən cəhd edin'); }
  }

  function set(action: TillAction, rule: Rule) {
    const current = rules ?? {};
    void save({ ...current, [role]: { ...current[role], [action]: rule } });
  }

  const managers = staff.filter(s => s.active && s.role === 'manager');

  return (
    <div className="space-y-4">
      {managers.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-xs text-amber-800">
          Menecer yoxdur. “Admin PIN” işləməsi üçün Əməkdaşlar siyahısında bir nəfərin vəzifəsini “Menecer” edin.
        </div>
      )}
      {staff.every(s => !s.active) && (
        <div className="bg-stone-50 border border-stone-200 rounded-xl px-4 py-2.5 text-xs text-stone-600">
          Qaydalar yalnız kassada PIN ilə daxil olan əməkdaşlara aiddir.
        </div>
      )}

      <div className="bg-white rounded-xl border border-stone-100 p-4 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-stone-700">Kassada icazələr</p>
            <p className="text-xs text-stone-500">Hər vəzifə üçün: sərbəst, menecerin PIN-i ilə, ya da qadağan. Menecerdən PIN soruşulmur.</p>
          </div>
          <div className="flex gap-0.5 bg-stone-100 rounded-lg p-0.5">
            {ROLES.map(r => (
              <button key={r} onClick={() => setRole(r)}
                className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors ${role === r ? 'bg-white shadow-sm text-stone-800' : 'text-stone-600 hover:text-stone-800'}`}>
                {ROLE_NAMES[r]}
              </button>
            ))}
          </div>
        </div>

        {!loaded ? (
          <p className="text-sm text-stone-400 py-6 text-center">
            {error ? <button onClick={load} className="text-primary-700 font-semibold">{error} — yenidən cəhd et</button> : 'Yüklənir…'}
          </p>
        ) : (
          <div className="divide-y divide-stone-100">
            {TILL_ACTIONS.map(a => {
              const current = ruleFor(rules, role, a.id);
              return (
                <div key={a.id} className="flex items-center justify-between gap-3 py-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-stone-800">{a.label}</p>
                    <p className="text-xs text-stone-500">{a.hint}</p>
                  </div>
                  <div className="flex gap-0.5 bg-stone-100 rounded-lg p-0.5 shrink-0">
                    {RULES.map(r => {
                      const Icon = r.icon;
                      return (
                        <button key={r.id} disabled={saving} onClick={() => current !== r.id && set(a.id, r.id)}
                          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-60 ${current === r.id ? r.on : 'text-stone-500 hover:text-stone-700'}`}>
                          <Icon className="w-3.5 h-3.5" />{r.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
          <p className="text-xs text-stone-400">
            “Admin PIN” seçiləndə kassada PIN pəncərəsi açılır; istənilən menecerin PIN-i keçir və adı sifarişdə yazılır.
          </p>
          <button disabled={saving || !loaded} onClick={() => void save(TILL_RULES_NEW)}
            className="text-xs font-semibold text-primary-700 hover:text-primary-900 disabled:opacity-50 shrink-0">
            Tövsiyə olunanı tətbiq et
          </button>
        </div>
        {loaded && error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    </div>
  );
}

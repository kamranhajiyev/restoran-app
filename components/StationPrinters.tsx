'use client';

// The sexes' printer IPs, editable from the till.
//
// A till opened with only its terminal link cannot reach admin → Sexlər, and it
// is the machine standing next to the printers. Only the IP is editable here;
// naming, adding and removing sexes stay in admin.

import { useState } from 'react';
import { Check, Loader2, Network, X } from 'lucide-react';
import { fetchStationPrinters, saveStationPrinter, type StationPrinterRow } from '@/lib/desktopPrint';

// The same check the admin panel and /api/update-station-printer make.
function isValidIp(ip: string): boolean {
  const parts = ip.split('.');
  return parts.length === 4 && parts.every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

export default function StationPrinters({ companyId, token }: { companyId: string; token: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<StationPrinterRow[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function show() {
    setOpen(true);
    setRows(null);
    setError(null);
    setSaved(null);
    const list = await fetchStationPrinters(companyId);
    setRows(list);
    setDraft(Object.fromEntries(list.map(s => [s.id, s.printerIp ?? ''])));
  }

  async function save(s: StationPrinterRow) {
    const ip = (draft[s.id] ?? '').trim();
    if (ip && !isValidIp(ip)) { setError(`${s.name}: IP düzgün deyil (məs: 192.168.1.50)`); return; }
    setError(null);
    setSaving(s.id);
    const ok = await saveStationPrinter(companyId, token, s.id, ip || null);
    setSaving(null);
    if (!ok) { setError(`${s.name}: yadda saxlanmadı — interneti yoxlayın`); return; }
    setRows(prev => prev?.map(r => r.id === s.id ? { ...r, printerIp: ip || null } : r) ?? prev);
    setSaved(s.id);
  }

  return (
    <>
      <button
        onClick={show}
        title="Sex printerləri"
        className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-50 border border-stone-100 rounded-xl hover:border-primary-300 hover:bg-primary-50 transition-colors"
      >
        <Network className="w-4 h-4 text-stone-600" />
        <span className="hidden sm:inline text-xs font-semibold text-stone-700">Printerlər</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <p className="font-semibold text-stone-800">Sex printerləri</p>
              <button onClick={() => setOpen(false)} className="text-stone-400 hover:text-stone-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {rows === null && <p className="text-sm text-stone-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Yüklənir…</p>}
            {rows?.length === 0 && <p className="text-sm text-stone-500">Sex yoxdur. Sexləri admin paneldə əlavə edin.</p>}

            <div className="space-y-3">
              {rows?.map(s => {
                const changed = (draft[s.id] ?? '').trim() !== (s.printerIp ?? '');
                return (
                  <div key={s.id}>
                    <p className="text-xs font-semibold text-stone-600 mb-1">{s.name}</p>
                    <div className="flex gap-2">
                      <input
                        value={draft[s.id] ?? ''}
                        onChange={e => { setDraft(d => ({ ...d, [s.id]: e.target.value })); setSaved(null); }}
                        placeholder="Printer IP (məs: 192.168.1.50)"
                        inputMode="decimal"
                        className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-primary-400"
                      />
                      <button
                        onClick={() => save(s)}
                        disabled={!changed || saving !== null}
                        className="px-3 py-2 rounded-xl bg-primary-800 hover:bg-primary-900 disabled:opacity-40 text-white text-sm font-semibold transition-colors flex items-center gap-1"
                      >
                        {saving === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : saved === s.id && !changed ? <Check className="w-4 h-4" /> : 'Saxla'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
            <p className="mt-4 text-[11px] text-stone-400 leading-relaxed">
              Printer və bu kompüter eyni şəbəkədə olmalıdır.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

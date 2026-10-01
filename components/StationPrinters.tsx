'use client';

// The sexes' printer IPs, editable from the till.
//
// A till opened with only its terminal link cannot reach admin → Sexlər, and it
// is the machine standing next to the printers. Only the IP is editable here;
// naming, adding and removing sexes stay in admin.

import { useState } from 'react';
import { Check, Loader2, Network, Search, X } from 'lucide-react';
import { fetchStationPrinters, saveStationPrinter, type StationPrinterRow } from '@/lib/desktopPrint';
import { USB_PRINTER, isUsbPrinter, isValidPrinterTarget, printerLabel } from '@/lib/station-printer';
import { pullStations } from '@/lib/till-sync';

export default function StationPrinters({ companyId, token }: { companyId: string; token: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<StationPrinterRow[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Printers found on the network by the desktop app, and the sex a tapped one
  // goes to — the row last touched.
  const [found, setFound] = useState<string[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const canScan = typeof window !== 'undefined' && !!window.posNative?.scanPrinters;

  async function show() {
    setOpen(true);
    setRows(null);
    setError(null);
    setSaved(null);
    setFound(null);
    setTarget(null);
    const list = await fetchStationPrinters(companyId);
    setRows(list);
    setDraft(Object.fromEntries(list.map(s => [s.id, s.printerIp ?? ''])));
  }

  async function scan() {
    setScanning(true);
    setError(null);
    try {
      setFound(await window.posNative!.scanPrinters!());
    } catch {
      setFound([]);
    } finally {
      setScanning(false);
    }
  }

  // A found printer into the row last touched, or else the first with none.
  function use(ip: string) {
    const id = target ?? rows?.find(r => !(draft[r.id] ?? '').trim())?.id ?? rows?.[0]?.id;
    if (!id) return;
    setDraft(d => ({ ...d, [id]: ip }));
    setTarget(id);
    setSaved(null);
  }

  async function save(s: StationPrinterRow) {
    const ip = (draft[s.id] ?? '').trim();
    if (ip && !isValidPrinterTarget(ip)) { setError(`${s.name}: IP düzgün deyil (məs: 192.168.1.50)`); return; }
    setError(null);
    setSaving(s.id);
    const ok = await saveStationPrinter(companyId, token, s.id, ip || null);
    setSaving(null);
    if (!ok) { setError(`${s.name}: yadda saxlanmadı — interneti yoxlayın`); return; }
    setRows(prev => prev?.map(r => r.id === s.id ? { ...r, printerIp: ip || null } : r) ?? prev);
    setSaved(s.id);
    // So the very next order prints on the new printer, not five minutes later.
    void pullStations(companyId);
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

            {canScan && !!rows?.length && (
              <div className="mb-4">
                <button
                  onClick={scan}
                  disabled={scanning}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-stone-200 text-sm font-semibold text-stone-700 hover:border-primary-300 hover:bg-primary-50 disabled:opacity-60 transition-colors"
                >
                  {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  {scanning ? 'Axtarılır…' : 'Şəbəkədə printer axtar'}
                </button>
                {found?.length === 0 && <p className="mt-2 text-xs text-stone-500">Printer tapılmadı. Printer yanılı və eyni şəbəkədədir?</p>}
                {!!found?.length && (
                  <div className="mt-2">
                    <p className="text-[11px] text-stone-400 mb-1">Toxunun — seçilmiş sexə yazılır:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {found.map(ip => (
                        <button key={ip} onClick={() => use(ip)}
                          className="px-2.5 py-1 rounded-lg bg-stone-50 border border-stone-200 text-xs font-mono text-stone-700 hover:border-primary-300 hover:bg-primary-50">
                          {ip}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-3">
              {rows?.map(s => {
                const changed = (draft[s.id] ?? '').trim() !== (s.printerIp ?? '');
                const usb = isUsbPrinter(draft[s.id]);
                return (
                  <div key={s.id} onFocusCapture={() => setTarget(s.id)} onClickCapture={() => setTarget(s.id)}>
                    <p className={`text-xs font-semibold mb-1 ${found?.length && target === s.id ? 'text-primary-800' : 'text-stone-600'}`}>{s.name}</p>
                    <div className="flex gap-2">
                      <input
                        value={usb ? printerLabel(USB_PRINTER) : draft[s.id] ?? ''}
                        readOnly={usb}
                        onChange={e => { setDraft(d => ({ ...d, [s.id]: e.target.value })); setSaved(null); }}
                        placeholder="Printer IP (məs: 192.168.1.50)"
                        inputMode="decimal"
                        className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-primary-400 read-only:bg-stone-50"
                      />
                      {/* The till's own receipt printer, for a sex standing beside it. */}
                      <button
                        onClick={() => { setDraft(d => ({ ...d, [s.id]: usb ? '' : USB_PRINTER })); setSaved(null); }}
                        title="Bu kassanın USB printeri"
                        className={`px-2.5 py-2 rounded-xl border text-xs font-semibold transition-colors ${usb ? 'border-primary-400 bg-primary-50 text-primary-800' : 'border-stone-200 text-stone-500 hover:border-primary-300'}`}
                      >
                        USB
                      </button>
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
              Printer və bu kompüter eyni şəbəkədə olmalıdır. USB — sexin çeki bu kassanın öz printerindən çıxır.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

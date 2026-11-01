'use client';
import { useEffect, useRef, useState } from 'react';
import { Building2, Check, ChevronDown } from 'lucide-react';
import { loadVenues, switchVenue } from '@/lib/switch-company-session';
import type { Venue } from '@/lib/switch-company';

// The owner's məkans in the admin header (lib/switch-company-session). Shows
// nothing for an owner with one məkan.
export default function VenueSwitcher({ currentId, onError }: { currentId: string | null; onError: (msg: string) => void }) {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { loadVenues().then(setVenues); }, [currentId]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (venues.length < 2) return null;
  const current = venues.find(v => v.id === currentId);

  async function pick(v: Venue) {
    if (busyId || v.id === currentId) { setOpen(false); return; }
    setBusyId(v.id);
    const r = await switchVenue(v.id, venues);
    // A full load, so nothing of the last məkan stays in memory.
    if (r.moved) {
      // The page reloads under a dialog, so this one has to stop it.
      if (r.error) window.alert(r.error);
      window.location.assign('/admin');
      return;
    }
    setBusyId(null);
    if (r.error) onError(r.error);
  }

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title="Məkanı dəyiş"
        className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-50 border border-stone-100 rounded-xl hover:border-primary-300 hover:bg-primary-50 transition-colors"
      >
        <Building2 className="w-4 h-4 text-primary-700 shrink-0" />
        <span className="text-xs font-semibold text-primary-800 truncate max-w-[110px] sm:max-w-[180px]">{current?.name ?? 'Məkan'}</span>
        <ChevronDown className="w-3.5 h-3.5 text-stone-500 shrink-0" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-64 max-w-[calc(100vw-2rem)] bg-white border border-stone-100 rounded-xl shadow-lg py-1 z-50">
          {venues.map(v => (
            <button
              key={v.id}
              onClick={() => pick(v)}
              disabled={!!busyId}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-stone-700 hover:bg-primary-50 disabled:opacity-60"
            >
              <span className="flex-1 truncate">{v.name}</span>
              {busyId === v.id
                ? <span className="w-4 h-4 border-2 border-stone-300 border-t-primary-800 rounded-full animate-spin" />
                : v.id === currentId && <Check className="w-4 h-4 text-primary-700" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

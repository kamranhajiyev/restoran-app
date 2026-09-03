'use client';

// The one thing the waiter needs to know about the network, and nothing more.
//
// The till itself never waits: it reads and writes the machine it is standing on
// (lib/till-data.ts, lib/till-write.ts) and the queue drains behind it. So an
// outage is not an error here and must never look like one — a red banner would
// teach a room full of staff to stop taking orders exactly when the design says
// they can carry on.
//
// What does matter is how much of tonight's service the server has not been told
// about, because that is what is lost if this machine dies. Hence a count rather
// than a status: three states, all quiet.
//
//   green   · everything sent
//   grey    · N waiting, no line
//   amber   · sending
//
// Tapping it says what those N are. That answer exists for one conversation —
// "is my order in?" — and it is worth a lot at eleven at night.
//
// The first run is the opposite of all this and blocks; see components/TillSetup.tsx.

import { useEffect, useState } from 'react';
import { Check, CloudOff, RefreshCw } from 'lucide-react';
import { ADD_ORDER, pendingEntries, type Pending } from '@/lib/sync';

// What each queued write is, in the words a waiter would use. Keyed by the API
// route the entry will replay to, which is what `kind` holds.
const LABELS: Record<string, string> = {
  [ADD_ORDER]: 'Yeni sifariş',
  '/api/add-order-items': 'Sifarişə əlavə',
  '/api/update-order-item-qty': 'Say dəyişdi',
  '/api/remove-order-item': 'Məhsul silindi',
  '/api/update-order-status': 'Status dəyişdi',
  '/api/cancel-order': 'Ləğv edildi',
  '/api/move-table': 'Masa dəyişdi',
  '/api/open-shift': 'Növbə açıldı',
  '/api/add-shift-movement': 'Kassa əməliyyatı',
  '/api/close-shift': 'Növbə bağlandı',
};

const label = (kind: string) => LABELS[kind] ?? 'Əməliyyat';

/** hh:mm, because the date is always today — nothing waits overnight in practice. */
function at(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function SyncStatus({
  online,
  pending,
  sending,
  compact = false,
}: {
  online: boolean;
  /** How many writes the server has not seen. */
  pending: number;
  /** A flush is running right now. */
  sending: boolean;
  /** The sidebar is collapsed: icon only, no room for words. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Pending[] | null>(null);

  // Only while the panel is open, and only from the local store — this reads
  // what is queued, it never triggers a send.
  useEffect(() => {
    if (!open) return;
    let live = true;
    const load = () => void pendingEntries().then(rows => { if (live) setList(rows); });
    load();
    const t = setInterval(load, 2000);
    return () => { live = false; clearInterval(t); };
  }, [open, pending]);

  const synced = pending === 0;
  const tone = !online
    ? 'bg-stone-200 text-stone-700'
    : synced
      ? 'bg-emerald-50 text-emerald-700'
      : 'bg-amber-100 text-amber-800';

  const icon = !online
    ? <CloudOff className="w-3 h-3" />
    : sending && !synced
      ? <RefreshCw className="w-3 h-3 animate-spin" />
      : synced
        ? <Check className="w-3 h-3" />
        : <RefreshCw className="w-3 h-3" />;

  // Two facts in one line, because a waiter asks two questions and they have
  // different answers: is the line up, and does the server have tonight's
  // service. "Everything sent" while the cable is out is perfectly possible —
  // it just means nothing new has happened since it dropped.
  const text = synced
    ? online ? 'Onlayn · göndərildi' : 'Oflayn · hamısı göndərilib'
    : sending
      ? `Göndərilir · ${pending}`
      : `Oflayn · gözləyir ${pending}`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { setList(null); setOpen(o => !o); }}
        title={online ? text : `Oflayn · ${text}`}
        aria-label={text}
        className={`flex items-center gap-1 rounded-full font-medium whitespace-nowrap transition-colors ${tone} ${
          compact ? 'p-1.5' : 'px-1.5 py-0.5 text-[10px]'
        }`}
      >
        {icon}
        {!compact && <span>{text}</span>}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 z-50 w-60 rounded-xl border border-stone-200 bg-white shadow-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-stone-700">Göndərilməyənlər</span>
            <span className="text-[10px] text-stone-400">{online ? 'onlayn' : 'oflayn'}</span>
          </div>

          {list === null && <p className="text-xs text-stone-400">Yoxlanılır…</p>}

          {list?.length === 0 && (
            <p className="text-xs text-stone-500">
              Hər şey serverdədir. Bu kompüterdə gözləyən əməliyyat yoxdur.
            </p>
          )}

          {list && list.length > 0 && (
            <ul className="max-h-56 overflow-y-auto -mx-1">
              {list.slice(0, 50).map((e, i) => (
                <li key={e.id} className="flex items-center gap-2 px-1 py-1 text-xs">
                  {/* The first one is the one being sent; everything else is
                      behind it, and stays behind it — see the FIFO rule in
                      lib/sync.ts. Showing that order is the honest picture. */}
                  <span className="w-4 text-stone-300 tabular-nums">{i + 1}</span>
                  <span className="text-stone-700 truncate">{label(e.kind)}</span>
                  <span className="ml-auto text-stone-400 tabular-nums">
                    {at(e.queuedAt ?? '')}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {list && list.length > 50 && (
            <p className="mt-1 text-[10px] text-stone-400">və daha {list.length - 50}</p>
          )}

          <p className="mt-2 text-[10px] text-stone-400 leading-relaxed">
            Sifarişlər bu kompüterdə saxlanılır və internet qayıdanda öz-özünə göndərilir.
          </p>
        </div>
      )}
    </div>
  );
}

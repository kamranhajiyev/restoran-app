'use client';
import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { Order } from '@/types';
import { orderLabel } from '@/lib/order-label';
import { canSplit, splitParts, splitPieces, type SplitPart } from '@/lib/split-bill';

// A guest is told apart by the number in the badge first; the colours differ in
// lightness too, so two guests never look the same on a dim screen.
const GUEST_COLORS = [
  'bg-stone-700 text-white',
  'bg-blue-600 text-white',
  'bg-orange-500 text-white',
  'bg-teal-700 text-white',
  'bg-purple-600 text-white',
  'bg-pink-600 text-white',
];
const GUEST_RINGS = [
  'border-stone-700',
  'border-blue-600',
  'border-orange-500',
  'border-teal-700',
  'border-purple-600',
  'border-pink-600',
];
const MAX_GUESTS = GUEST_COLORS.length;

function GuestBadge({ guest, small }: { guest: number; small?: boolean }) {
  return (
    <span className={`inline-flex items-center justify-center rounded-full font-bold tabular-nums shrink-0 ${small ? 'w-6 h-6 text-xs' : 'w-9 h-9 text-sm'} ${GUEST_COLORS[guest - 1]}`}>
      {guest}
    </span>
  );
}

export default function SplitBill({ order, tableLabel, busy, onCancel, onConfirm }: {
  order: Order;
  tableLabel: string;
  /** The split is being written: the button waits. */
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (parts: SplitPart[]) => void;
}) {
  const pieces = useMemo(() => splitPieces(order.items), [order.items]);
  // Everything starts on guest 1, the bill as it is now; the waiter only moves
  // what the others are paying for.
  const [owner, setOwner] = useState<number[]>(() => pieces.map(() => 1));
  const [guests, setGuests] = useState(2);
  const [active, setActive] = useState(2);

  const parts = splitParts(pieces, owner, guests, order.serviceChargePercent ?? 0);
  const ready = canSplit(parts);
  const billCount = parts.filter(p => p.items.length > 0).length;

  function tapPiece(i: number) {
    // A second tap on a piece already with the chosen guest hands it back to
    // guest 1, so a wrong tap is undone where it was made.
    setOwner(o => o.map((g, j) => (j !== i ? g : g === active && active !== 1 ? 1 : active)));
  }

  function addGuest() {
    if (guests >= MAX_GUESTS) return;
    setGuests(guests + 1);
    setActive(guests + 1);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-4xl h-[92vh] sm:h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200">
          <div>
            <h3 className="font-bold text-lg text-stone-800">Hesabı böl</h3>
            <p className="text-sm text-stone-600">№{orderLabel(order)} · {tableLabel}</p>
          </div>
          <button onClick={onCancel} aria-label="Bağla" className="p-2 rounded-lg text-stone-500 hover:bg-stone-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Guests: pick one, then tap the dishes that are theirs */}
        <div className="px-5 py-3 border-b border-stone-200 bg-stone-50">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {parts.map(p => {
              const picked = p.guest === active;
              return (
                <button
                  key={p.guest}
                  onClick={() => setActive(p.guest)}
                  className={`flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full border-2 bg-white shrink-0 transition-colors active:scale-95 ${picked ? GUEST_RINGS[p.guest - 1] : 'border-stone-200 hover:border-stone-300'}`}
                >
                  <GuestBadge guest={p.guest} small />
                  <span className="text-sm font-semibold text-stone-800 tabular-nums">{p.total.toFixed(2)} ₼</span>
                </button>
              );
            })}
            {guests < MAX_GUESTS && (
              <button
                onClick={addGuest}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full border-2 border-dashed border-stone-300 text-sm font-semibold text-stone-600 hover:bg-white shrink-0"
              >
                <Plus className="w-4 h-4" /> Qonaq
              </button>
            )}
          </div>
          <p className="text-xs text-stone-600 mt-2">
            {active === 1
              ? 'Qonaq 1 seçilib — məhsula toxunsanız ona qayıdır.'
              : `Qonaq ${active} seçilib — onun ödədiyi məhsullara toxunun.`}
          </p>
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* Pieces */}
          <div className="flex-1 min-w-0 overflow-y-auto">
            {pieces.map((p, i) => {
              const g = owner[i];
              const mine = g === active;
              return (
                <button
                  key={i}
                  onClick={() => tapPiece(i)}
                  className={`w-full flex items-center gap-3 px-5 py-2.5 border-b border-stone-100 text-left transition-colors active:bg-stone-100 ${mine ? 'bg-stone-50' : 'hover:bg-stone-50'}`}
                >
                  <GuestBadge guest={g} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-stone-800 truncate">{p.item.menuItem.name}</span>
                    {p.item.modifiers && <span className="block text-xs text-primary-600 truncate">{p.item.modifiers}</span>}
                  </span>
                  {p.quantity !== 1 && <span className="text-xs text-stone-500 tabular-nums">{p.quantity}</span>}
                  <span className="text-sm font-semibold text-stone-700 tabular-nums w-20 text-right">
                    {(p.item.menuItem.price * p.quantity).toFixed(2)} ₼
                  </span>
                </button>
              );
            })}
          </div>

          {/* Each guest's bill, as it will be — wide screens only; on a phone the
              guest chips above already carry the totals. */}
          <div className="hidden md:block w-80 shrink-0 border-l border-stone-200 bg-stone-50 overflow-y-auto p-4 space-y-3">
            {parts.map(p => (
              <button
                key={p.guest}
                onClick={() => setActive(p.guest)}
                className={`w-full text-left bg-white rounded-xl border-2 p-3 transition-colors ${p.guest === active ? GUEST_RINGS[p.guest - 1] : 'border-stone-200 hover:border-stone-300'}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <GuestBadge guest={p.guest} small />
                  <span className="text-sm font-semibold text-stone-800">Qonaq {p.guest}</span>
                  <span className="ml-auto text-xs text-stone-500">
                    {p.guest === 1 ? `№${orderLabel(order)}` : p.items.length ? 'yeni qəbz' : ''}
                  </span>
                </div>
                {p.items.length === 0
                  ? <p className="text-xs text-stone-500">Boş</p>
                  : (
                    <div className="space-y-0.5">
                      {p.items.map((oi, j) => (
                        <div key={j} className="flex justify-between text-xs text-stone-700">
                          <span className="truncate pr-2">{oi.menuItem.name}{oi.quantity !== 1 ? ` ×${oi.quantity}` : ''}</span>
                          <span className="tabular-nums">{(oi.menuItem.price * oi.quantity).toFixed(2)}</span>
                        </div>
                      ))}
                      {p.charge > 0 && (
                        <div className="flex justify-between text-xs text-stone-500">
                          <span>Xidmət haqqı</span>
                          <span className="tabular-nums">{p.charge.toFixed(2)}</span>
                        </div>
                      )}
                    </div>
                  )}
                <div className="flex justify-between mt-2 pt-2 border-t border-stone-100 text-sm font-bold text-stone-800">
                  <span>Cəmi</span>
                  <span className="tabular-nums">{p.total.toFixed(2)} ₼</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 py-4 border-t border-stone-200">
          <button onClick={onCancel} className="flex-1 py-3 rounded-xl border border-stone-200 text-sm font-semibold text-stone-600 hover:bg-stone-50">
            Bölgünü ləğv et
          </button>
          <button
            onClick={() => onConfirm(parts.filter(p => p.items.length > 0))}
            disabled={!ready || busy}
            className="flex-1 py-3 rounded-xl flex items-center justify-center gap-2 bg-primary-800 hover:bg-primary-900 disabled:opacity-40 text-white font-semibold text-sm active:scale-95 transition-colors"
          >
            {busy && <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
            {ready ? `Böl — ${billCount} qəbz` : 'Ən azı 2 qonağa məhsul verin'}
          </button>
        </div>
      </div>
    </div>
  );
}

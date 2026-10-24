'use client';

// The box a manager types their PIN into when an action needs approval
// (lib/till-rules). Only the keypad: checking the PIN is the seller page's job.

import { Delete, ShieldCheck, X } from 'lucide-react';

export function ApprovalPad({ action, pin, msg, busy, onDigit, onBack, onCancel }: {
  action: string;
  pin: string;
  msg: string;
  busy: boolean;
  onDigit: (d: string) => void;
  onBack: () => void;
  onCancel: () => void;
}) {
  const key = 'w-16 h-16 rounded-2xl bg-white border border-stone-200 text-2xl font-semibold text-stone-700 hover:bg-stone-50 active:scale-95 transition-all disabled:opacity-50';
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 px-4">
      <div className="bg-[#f7f3ed] rounded-2xl shadow-xl p-6 w-full max-w-xs flex flex-col items-center relative">
        <button onClick={onCancel} disabled={busy} aria-label="Bağla"
          className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-lg text-stone-500 hover:bg-stone-200/60">
          <X className="w-4 h-4" />
        </button>
        <div className="w-11 h-11 rounded-2xl bg-amber-100 flex items-center justify-center mb-3">
          <ShieldCheck className="w-6 h-6 text-amber-700" />
        </div>
        <p className="font-bold text-stone-800">Menecer təsdiqi</p>
        <p className="text-sm text-stone-500 mt-0.5 mb-4 text-center">{action} — menecerin PIN kodu</p>

        <div className="flex gap-3 mb-2 h-4 items-center">
          {[0, 1, 2, 3].map(i => (
            <span key={i} className={`rounded-full transition-all ${i < pin.length ? 'w-3.5 h-3.5 bg-primary-800' : 'w-3 h-3 bg-stone-300'}`} />
          ))}
        </div>
        <p className={`text-sm min-h-5 mb-3 text-center ${msg ? 'text-red-500' : 'text-transparent'}`}>{msg || '·'}</p>

        <div className="grid grid-cols-3 gap-2.5">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
            <button key={d} onClick={() => onDigit(d)} disabled={busy} className={key}>{d}</button>
          ))}
          <span />
          <button onClick={() => onDigit('0')} disabled={busy} className={key}>0</button>
          <button onClick={onBack} disabled={busy || pin.length === 0}
            className="w-16 h-16 rounded-2xl flex items-center justify-center text-stone-500 hover:bg-stone-200/50 active:scale-95 transition-all disabled:opacity-30">
            {busy
              ? <span className="w-5 h-5 border-2 border-stone-300 border-t-primary-800 rounded-full animate-spin" />
              : <Delete className="w-6 h-6" />}
          </button>
        </div>
      </div>
    </div>
  );
}

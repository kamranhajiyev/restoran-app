'use client';

// The box a manager types their PIN into, or taps their card on, when an
// action needs approval (lib/till-rules). Only the keypad and the reader:
// checking the PIN or the card is the seller page's job. A laptop keyboard
// types into it too (2026-10-25, Natiq); Esc closes it. The card reader is a
// keyboard as well, told apart from typing by lib/card-reader.

import { useEffect, useRef } from 'react';
import { CreditCard, Delete, ShieldCheck, X } from 'lucide-react';
import { pinKey } from '@/lib/pin-keys';
import { cardCatcher, cardNumber } from '@/lib/card-reader';
import { listenNfc } from '@/lib/android-nfc';
import type { ApproveWith } from '@/lib/till-rules';

export function ApprovalPad({ action, mode = 'pin', pin, msg, busy, onDigit, onBack, onCancel, onCard }: {
  action: string;
  mode?: ApproveWith;
  pin: string;
  msg: string;
  busy: boolean;
  onDigit: (d: string) => void;
  onBack: () => void;
  onCancel: () => void;
  onCard: (card: string) => void;
}) {
  const cards = mode !== 'pin';
  const pins = mode !== 'card';
  // The catcher outlives renders; it reaches the latest props through this.
  const latest = useRef({ busy, pins, onDigit, onCard });
  useEffect(() => { latest.current = { busy, pins, onDigit, onCard }; });
  const catcher = useRef<ReturnType<typeof cardCatcher> | null>(null);
  useEffect(() => {
    const c = cardCatcher(
      card => { if (!latest.current.busy) latest.current.onCard(card); },
      // Too short for a card: a person typing a PIN, where a PIN is taken.
      keys => {
        if (latest.current.busy || !latest.current.pins) return;
        // Together, in one call: one at a time, the second would land on a PIN
        // the page has not updated yet, and a digit would be lost.
        const digits = keys.replace(/\D/g, '');
        if (digits) latest.current.onDigit(digits);
      },
    );
    catcher.current = c;
    return () => { c.stop(); catcher.current = null; };
  }, []);

  // In the Android app, the phone's NFC reads cards too, only while this waits.
  useEffect(() => {
    if (!cards) return;
    return listenNfc(hex => {
      const card = cardNumber(hex);
      if (card && !latest.current.busy) latest.current.onCard(card);
    });
  }, [cards]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (cards && (e.key === 'Enter' || e.key === 'Tab')) {
        e.preventDefault();
        catcher.current?.enter();
        return;
      }
      if (cards && (e.key === ',' || e.key === '.')) {
        e.preventDefault();
        catcher.current?.key(e.key);
        return;
      }
      const k = pinKey(e);
      if (!k) return;
      // The box sits above everything: a digit must not also land in a field behind it.
      e.preventDefault();
      if (busy) return;
      if (typeof k === 'object') {
        if (cards) catcher.current?.key(k.digit);
        else onDigit(k.digit);
      }
      else if (k === 'back') { if (pins && pin.length > 0) onBack(); }
      else onCancel();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [busy, pin, cards, pins, onDigit, onBack, onCancel]);

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
        <p className="text-sm text-stone-500 mt-0.5 mb-4 text-center">
          {action} — {mode === 'card' ? 'menecerin kartı' : mode === 'both' ? 'menecerin kartı və ya PIN kodu' : 'menecerin PIN kodu'}
        </p>

        {cards && (
          <div className={`w-full flex items-center gap-3 rounded-xl border border-dashed border-amber-300 bg-amber-50 px-4 py-3 ${pins ? 'mb-4' : 'mb-2'}`}>
            {busy && !pins
              ? <span className="w-6 h-6 border-2 border-amber-200 border-t-amber-700 rounded-full animate-spin shrink-0" />
              : <CreditCard className="w-6 h-6 text-amber-700 shrink-0" />}
            <p className="text-sm font-medium text-amber-800">Kartı oxuyucuya yaxınlaşdırın</p>
          </div>
        )}
        {!pins && <p className={`text-sm min-h-5 text-center ${msg ? 'text-red-500' : 'text-transparent'}`}>{msg || '·'}</p>}

        {pins && <>
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
        </>}
      </div>
    </div>
  );
}

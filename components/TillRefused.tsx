'use client';

// The till's screen when the server says no to its link — in the browser
// (/s/<slug>/<token>) and in the exe/APK alike, so both say the same thing.
//
// "Məkan deaktiv edilib" and "Abunəliyin müddəti bitib" are not a broken link:
// nobody needs a new one, and the same link opens again on its own once the
// restaurant is switched back on or has paid (lib/subscription.ts). Only a
// wrong or rotated link sends them back to admin for a new one.
//
// Sales rung up before the stop and not yet sent are sent from here too: an
// expired till may still write, and a switched-off one keeps them waiting
// (lib/sync linkRefused) — either way nothing in the queue is lost.

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { SUPPORT_URL, TILL_REFUSAL_TEXT, type TillRefusal } from '@/lib/subscription';
import { flushQueue } from '@/lib/sync';
import { setTillToken } from '@/lib/till-data';
import { LINK_CHECK_MS } from '@/lib/link-check';

interface Props {
  reason: TillRefusal;
  /** Which restaurant the waiting sales belong to; null when nobody knows. */
  companyId: string | null;
  token: string | null;
  /** Ask the server again. Also run on its own every few minutes. */
  onRetry?: () => Promise<void>;
  /** Shown for a wrong link only: the way back to admin for a new one. */
  onAdmin?: () => void;
}

export default function TillRefused({ reason, companyId, token, onRetry, onAdmin }: Props) {
  const [busy, setBusy] = useState(false);
  const text = TILL_REFUSAL_TEXT[reason];

  useEffect(() => {
    if (!companyId) return;
    if (token) setTillToken(token);
    void flushQueue(companyId).catch(() => { /* kept for the next try */ });
  }, [companyId, token]);

  useEffect(() => {
    if (!onRetry || reason === 'invalid') return;
    const id = setInterval(() => { void onRetry(); }, LINK_CHECK_MS);
    return () => clearInterval(id);
  }, [onRetry, reason]);

  async function retry() {
    if (!onRetry || busy) return;
    setBusy(true);
    try { await onRetry(); } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <p className="text-stone-800 font-semibold mb-1">{text.title}</p>
        <p className="text-stone-500 text-sm">{text.hint}</p>
        <div className="mt-5 flex flex-col items-center gap-2">
          {reason !== 'invalid' && (
            <a
              href={SUPPORT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition-colors"
            >
              {reason === 'expired' ? 'Ödəniş et' : 'Əlaqə saxla'}
            </a>
          )}
          {reason !== 'invalid' && onRetry && (
            <button
              onClick={retry}
              disabled={busy}
              className="px-4 py-2 rounded-xl border border-stone-200 text-sm text-stone-600 hover:bg-stone-100 disabled:opacity-60 transition-colors inline-flex items-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Yenidən yoxla
            </button>
          )}
          {/* A rotated link would otherwise leave the desktop shell — which has no
              browser chrome and reopens this very page — stranded on this screen
              for good. Forget the till and offer the way back to admin. */}
          {onAdmin && (
            <button
              onClick={onAdmin}
              className="px-4 py-2 rounded-xl border border-stone-200 text-sm text-stone-600 hover:bg-stone-100 transition-colors"
            >
              Admin panelinə keç
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';
import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { forgetTill } from '@/lib/auth';
import { LINK_CHECK_MS } from '@/lib/link-check';
import { focusRefreshDue } from '@/lib/focus-refresh';
import { tillRefusal, type TillRefusal } from '@/lib/subscription';
import TillRefused from '@/components/TillRefused';
// The till itself, not the /seller route's wrapper: this route has already
// resolved the terminal from the address bar, and asking the machine which
// terminal it is would be a second, contradictory answer.
import { SellerPage } from '@/app/seller/page';

type ReadyState = { status: 'ready'; companyId: string; companyName: string; logoUrl: string | null; brandColor: string | null; expiresAt: string | null };

// What this terminal was last told about itself, so an outage does not lock it
// out. Scoped to the exact link: a rotated token has no cache of its own and
// still has to reach the server.
const terminalKey = (slug: string, token: string) => `possiblle.terminal.${slug}.${token}`;

function rememberTerminal(slug: string, token: string, state: ReadyState): void {
  try { localStorage.setItem(terminalKey(slug, token), JSON.stringify(state)); } catch { /* storage full or blocked */ }
}

function recallTerminal(slug: string, token: string): ReadyState | null {
  try {
    const raw = localStorage.getItem(terminalKey(slug, token));
    return raw ? (JSON.parse(raw) as ReadyState) : null;
  } catch {
    return null;
  }
}

function forgetTerminal(slug: string, token: string): void {
  try { localStorage.removeItem(terminalKey(slug, token)); } catch { /* nothing stored */ }
}

export default function PublicSellerPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = use(params);
  const router = useRouter();

  const [state, setState] = useState<
    | { status: 'loading' }
    // The server said no. companyId is what this machine last knew, so sales
    // still waiting to be sent can go from the stop screen (components/TillRefused).
    | { status: 'refused'; reason: TillRefusal; companyId: string | null }
    | ReadyState
  >({ status: 'loading' });

  const ask = useCallback(async (): Promise<'ok' | 'refused' | 'offline'> => {
    let r: Response;
    try {
      r = await fetch(`/api/seller-token?slug=${encodeURIComponent(slug)}&token=${encodeURIComponent(token)}`);
    } catch {
      return 'offline';
    }
    const d = await r.json().catch(() => null);
    if (r.ok && d?.companyId) {
      const ready: ReadyState = { status: 'ready', companyId: d.companyId, companyName: d.companyName, logoUrl: d.logoUrl ?? null, brandColor: d.brandColor ?? null, expiresAt: d.expiresAt ?? null };
      // An open till only takes the fresh expiry: a renewal paid mid-shift clears
      // the banner without remounting the till under the seller. A stopped one
      // opens again — the restaurant paid, or was switched back on.
      setState(s => (s.status === 'ready' ? { ...s, expiresAt: ready.expiresAt } : ready));
      // Kept so the terminal can open itself again during an outage. Only
      // ever written from a real answer, so a revoked link stops working as
      // soon as the server is reachable enough to say so.
      rememberTerminal(slug, token, ready);
      return 'ok';
    }
    // A 500 is the server having a bad minute, not an answer about this link.
    if (r.status !== 404) return 'offline';
    const known = recallTerminal(slug, token);
    forgetTerminal(slug, token);
    setState(s => ({
      status: 'refused',
      reason: tillRefusal(d),
      companyId: s.status === 'ready' ? s.companyId : s.status === 'refused' ? s.companyId : known?.companyId ?? null,
    }));
    return 'refused';
  }, [slug, token]);

  useEffect(() => {
    void ask().then(answer => {
      if (answer !== 'offline') return;
      // The line is down, not the link. Answering "etibarsız" here would put
      // the whole offline till behind an error screen it can never clear —
      // the terminal would be dead exactly when the queue was meant to save
      // it. Reopen on what this machine was last told.
      const cached = recallTerminal(slug, token);
      setState(cached ?? { status: 'refused', reason: 'invalid', companyId: null });
    });
  }, [ask, slug, token]);

  // Re-validate the link while the terminal stays open so rotating it ("Linki yenilə")
  // locks an already-open session — on an interval and whenever the tab regains focus —
  // without the seller needing to refresh. A 404 means the token was revoked, the
  // restaurant switched off, or its grace days over (that one lands at the start of
  // a business day, lib/subscription.ts); network blips are ignored so a transient
  // error doesn't lock a valid terminal. The same poll reopens a stopped till.
  useEffect(() => {
    let cancelled = false;
    let last = Date.now();
    const revalidate = async () => {
      if (document.visibilityState === 'hidden' || cancelled) return;
      last = Date.now();
      await ask();
    };
    const id = setInterval(revalidate, LINK_CHECK_MS);
    // At most once per half minute on focus (lib/focus-refresh.ts).
    const onFocus = () => { if (focusRefreshDue(last, Date.now())) revalidate(); };
    const onVisible = () => { if (document.visibilityState === 'visible') onFocus(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ask]);

  const retry = useCallback(async () => { await ask(); }, [ask]);

  if (state.status === 'loading') {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <p className="text-stone-500 text-sm">Yüklənir…</p>
      </div>
    );
  }

  if (state.status === 'refused') {
    return (
      <TillRefused
        reason={state.reason}
        companyId={state.companyId}
        token={token}
        onRetry={retry}
        onAdmin={state.reason === 'invalid' ? () => { forgetTill(); router.replace('/admin'); } : undefined}
      />
    );
  }

  return (
    <SellerPage
      overrideCompanyId={state.companyId}
      overrideCompanyName={state.companyName}
      overrideToken={token}
      overrideLogoUrl={state.logoUrl}
      overrideBrandColor={state.brandColor}
      overrideExpiresAt={state.expiresAt}
    />
  );
}

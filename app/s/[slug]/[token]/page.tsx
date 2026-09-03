'use client';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import SellerPage from '@/app/seller/page';
import { forgetTill } from '@/lib/auth';

export default function PublicSellerPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = use(params);
  const router = useRouter();

  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'invalid' }
    | { status: 'ready'; companyId: string; companyName: string; logoUrl: string | null; brandColor: string | null; expiresAt: string | null }
  >({ status: 'loading' });

  useEffect(() => {
    fetch(`/api/seller-token?slug=${encodeURIComponent(slug)}&token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(d => {
        if (d.companyId) setState({ status: 'ready', companyId: d.companyId, companyName: d.companyName, logoUrl: d.logoUrl ?? null, brandColor: d.brandColor ?? null, expiresAt: d.expiresAt ?? null });
        else setState({ status: 'invalid' });
      })
      .catch(() => setState({ status: 'invalid' }));
  }, [slug, token]);

  // Re-validate the link while the terminal stays open so rotating it ("Linki yenilə")
  // locks an already-open session — on an interval and whenever the tab regains focus —
  // without the seller needing to refresh. A 404 means the token was revoked; network
  // blips are ignored so a transient error doesn't lock a valid terminal.
  useEffect(() => {
    let cancelled = false;
    const revalidate = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const r = await fetch(`/api/seller-token?slug=${encodeURIComponent(slug)}&token=${encodeURIComponent(token)}`);
        if (cancelled) return;
        if (r.status === 404) { setState({ status: 'invalid' }); return; }
        // A renewal paid mid-shift should clear the subscription banner on its
        // own — this poll is already running, so it costs nothing to carry.
        if (r.ok) {
          const d = await r.json();
          if (!cancelled) {
            setState(s => (s.status === 'ready' ? { ...s, expiresAt: d.expiresAt ?? null } : s));
          }
        }
      } catch { /* ignore transient network errors */ }
    };
    const id = setInterval(revalidate, 40000);
    const onVisible = () => { if (document.visibilityState === 'visible') revalidate(); };
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [slug, token]);

  if (state.status === 'loading') {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <p className="text-stone-500 text-sm">Yüklənir…</p>
      </div>
    );
  }

  if (state.status === 'invalid') {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-stone-800 font-semibold mb-1">Bu keçid etibarsız</p>
          <p className="text-stone-500 text-sm">Admindən yeni link alın</p>
          {/* A rotated link would otherwise leave the desktop shell — which has no
              browser chrome and reopens this very page — stranded on this screen
              for good. Forget the till and offer the way back to admin. */}
          <button
            onClick={() => { forgetTill(); router.replace('/admin'); }}
            className="mt-5 px-4 py-2 rounded-xl border border-stone-200 text-sm text-stone-600 hover:bg-stone-100 transition-colors"
          >
            Admin panelinə keç
          </button>
        </div>
      </div>
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

'use client';
import { use, useEffect, useState } from 'react';
import SellerPage from '@/app/seller/SellerPageImpl';

export default function PublicSellerPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = use(params);

  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'invalid' }
    | { status: 'ready'; companyId: string; companyName: string }
  >({ status: 'loading' });

  useEffect(() => {
    fetch(`/api/seller-token?slug=${encodeURIComponent(slug)}&token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(d => {
        if (d.companyId) setState({ status: 'ready', companyId: d.companyId, companyName: d.companyName });
        else setState({ status: 'invalid' });
      })
      .catch(() => setState({ status: 'invalid' }));
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
        </div>
      </div>
    );
  }

  return (
    <SellerPage
      overrideCompanyId={state.companyId}
      overrideCompanyName={state.companyName}
    />
  );
}

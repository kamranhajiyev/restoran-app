'use client';

import { useEffect } from 'react';

/**
 * Registers the till's service worker.
 *
 * The scope is a prop because the till is served from two places: /seller for a
 * signed-in waiter, and /s/<slug>/<token> for the public terminal the desktop
 * app opens. A worker registered under /seller does not control /s/..., so the
 * terminal that most needs to survive an outage would have had no worker at all.
 */
export default function SellerSWRegister({ scope = '/seller' }: { scope?: string }) {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope }).catch(() => {});
    }
  }, [scope]);

  return null;
}

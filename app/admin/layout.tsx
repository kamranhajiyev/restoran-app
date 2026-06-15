'use client';

import { useEffect } from 'react';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/admin' }).catch(() => {});
    }
  }, []);

  return (
    <>
      <link rel="manifest" href="/admin-manifest.json" />
      {children}
    </>
  );
}

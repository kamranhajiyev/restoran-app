'use client';

import { useEffect } from 'react';

export default function SellerSWRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/seller' }).catch(() => {});
    }
  }, []);

  return null;
}

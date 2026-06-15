'use client';

import { useEffect } from 'react';

export default function AdminSWRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/admin' }).catch(() => {});
    }
  }, []);

  return null;
}

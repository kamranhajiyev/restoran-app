'use client';

import { useEffect } from 'react';
import { flushOrderQueue } from '@/lib/sync';
import { queueSize } from '@/lib/offline-queue';

interface Props {
  companyId: string | null;
  onQueueChange?: (count: number) => void;
}

export default function SellerSWRegister({ companyId, onQueueChange }: Props) {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker
      .register('/sw.js', { scope: '/seller', updateViaCache: 'none' })
      .catch(() => {});

    async function attemptSync() {
      if (!navigator.onLine || !companyId) return;
      try {
        const result = await flushOrderQueue(companyId);
        if (result.synced > 0) {
          console.info(`[sync] ${result.synced} offline order(s) synced on mount`);
        }
        if (onQueueChange) onQueueChange(await queueSize());
      } catch (e) {
        console.error('[sync] Mount sync failed:', e);
      }
    }

    attemptSync();

    async function handleOnline() {
      if (!companyId) return;
      try {
        const result = await flushOrderQueue(companyId);
        if (result.synced > 0) {
          console.info(`[sync] ${result.synced} offline order(s) synced after reconnect`);
        }
        if (onQueueChange) onQueueChange(await queueSize());
      } catch (e) {
        console.error('[sync] Online event sync failed:', e);
      }
    }

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [companyId, onQueueChange]);

  return null;
}

'use client';

import { useSyncExternalStore } from 'react';
import AppDialog from '@/components/AppDialog';
import { tillDialogs, type DialogQueue } from '@/lib/dialog-queue';

/** Shows the queue's popups one at a time (see lib/dialog-queue.ts). */
export default function DialogHost({ queue = tillDialogs }: { queue?: DialogQueue }) {
  const cur = useSyncExternalStore(queue.subscribe, queue.current, () => null);
  if (!cur) return null;
  return (
    <AppDialog
      dialog={{
        title: cur.title,
        message: cur.message,
        confirmLabel: cur.confirmLabel,
        onConfirm: cur.kind === 'confirm' ? () => queue.answer(cur.id, true) : undefined,
        onCancel: () => queue.answer(cur.id, false),
      }}
      // AppDialog closes before it confirms, so closing must not answer a confirm "no".
      onClose={() => { if (cur.kind === 'alert') queue.answer(cur.id, true); }}
    />
  );
}

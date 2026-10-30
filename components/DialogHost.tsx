'use client';

import { useState, useSyncExternalStore } from 'react';
import AppDialog from '@/components/AppDialog';
import { tillDialogs, type DialogQueue, type QueuedDialog } from '@/lib/dialog-queue';

/** Shows the queue's popups one at a time (see lib/dialog-queue.ts). */
export default function DialogHost({ queue = tillDialogs }: { queue?: DialogQueue }) {
  const cur = useSyncExternalStore(queue.subscribe, queue.current, () => null);
  if (!cur) return null;
  if (cur.kind === 'choose' || cur.kind === 'ask') {
    // Keyed by id, so the box starts from this dialog's text, not the last one's.
    return <AnswerDialog key={cur.id} dialog={cur} answer={a => queue.answer(cur.id, a)} />;
  }
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

/** A choice of buttons, or a box to type in. Ləğv et answers null. */
function AnswerDialog({ dialog, answer }: { dialog: QueuedDialog; answer: (a: number | string | null) => void }) {
  const [text, setText] = useState(dialog.value ?? '');
  const button = 'px-4 py-2 text-sm rounded-lg bg-stone-800 hover:bg-stone-700 text-white font-medium transition-colors';
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <form
        className="bg-white rounded-2xl shadow-xl p-6 w-80 space-y-4"
        onSubmit={e => { e.preventDefault(); if (dialog.kind === 'ask') answer(text); }}
      >
        <h3 className="text-base font-semibold text-stone-800">{dialog.title}</h3>
        {dialog.message && <p className="text-sm text-stone-600 whitespace-pre-line">{dialog.message}</p>}
        {dialog.kind === 'ask' && (
          <input
            autoFocus
            value={text}
            placeholder={dialog.placeholder}
            onChange={e => setText(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-stone-200 focus:outline-none focus:border-emerald-400"
          />
        )}
        <div className="flex flex-wrap gap-2 justify-end">
          <button type="button" onClick={() => answer(null)} className="px-4 py-2 text-sm rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors">Ləğv et</button>
          {dialog.kind === 'ask' ? (
            <button type="submit" className={button}>{dialog.confirmLabel}</button>
          ) : (
            dialog.choices?.map((label, i) => (
              <button key={label} type="button" onClick={() => answer(i)} className={button}>{label}</button>
            ))
          )}
        </div>
      </form>
    </div>
  );
}

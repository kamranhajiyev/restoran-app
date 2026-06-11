'use client';

import { ReactNode } from 'react';

export type DialogState = {
  title: string;
  message: ReactNode;
  /** Label of the destructive/confirm button. Defaults to "Sil". */
  confirmLabel?: string;
  /** When present the dialog shows Ləğv et / confirm buttons; otherwise a single Bağla button. */
  onConfirm?: () => void;
};

export default function AppDialog({ dialog, onClose }: { dialog: DialogState | null; onClose: () => void }) {
  if (!dialog) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl p-6 w-80 space-y-4">
        <h3 className="text-base font-semibold text-stone-800">{dialog.title}</h3>
        <p className="text-sm text-stone-600">{dialog.message}</p>
        <div className="flex gap-2 justify-end">
          {dialog.onConfirm ? (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors">Ləğv et</button>
              <button
                onClick={() => { const fn = dialog.onConfirm!; onClose(); fn(); }}
                className="px-4 py-2 text-sm rounded-lg bg-red-500 hover:bg-red-600 text-white font-medium transition-colors"
              >
                {dialog.confirmLabel ?? 'Sil'}
              </button>
            </>
          ) : (
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg bg-stone-800 hover:bg-stone-700 text-white font-medium transition-colors">Bağla</button>
          )}
        </div>
      </div>
    </div>
  );
}

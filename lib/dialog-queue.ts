/**
 * The till's own alert/confirm, in place of the browser's. Chrome's box says
 * "localhost:3000 says", has English OK/Cancel and looks different in the
 * browser, the exe and the APK; ours matches the rest of the page.
 *
 * Unlike window.confirm this cannot pause the code, so it hands back a promise:
 * `if (!(await askConfirm('…'))) return;`. Popups asked while one is open wait
 * their turn instead of replacing it.
 */

export type DialogOptions = {
  /** Label of the confirm button. Defaults to "Bəli". */
  confirmLabel?: string;
};

export type QueuedDialog = {
  id: number;
  kind: 'alert' | 'confirm';
  title: string;
  message: string;
  confirmLabel: string;
};

/**
 * The first paragraph is the title, the rest the text — so the messages keep
 * the "What happened.\n\nWhat to do." shape they had as browser popups.
 */
export function splitMessage(text: string): { title: string; message: string } {
  const at = text.indexOf('\n\n');
  if (at < 0) return { title: text.trim(), message: '' };
  return { title: text.slice(0, at).trim(), message: text.slice(at + 2).trim() };
}

export function createDialogQueue() {
  let items: { dialog: QueuedDialog; resolve: (ok: boolean) => void }[] = [];
  let nextId = 1;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(fn => fn());

  function push(kind: QueuedDialog['kind'], text: string, opts?: DialogOptions): Promise<boolean> {
    return new Promise(resolve => {
      const dialog = { id: nextId++, kind, ...splitMessage(text), confirmLabel: opts?.confirmLabel ?? 'Bəli' };
      items = [...items, { dialog, resolve }];
      emit();
    });
  }

  return {
    alert: (text: string): Promise<void> => push('alert', text).then(() => undefined),
    confirm: (text: string, opts?: DialogOptions): Promise<boolean> => push('confirm', text, opts),
    current: (): QueuedDialog | null => items[0]?.dialog ?? null,
    /** Answers the dialog with this id; a stale id (already answered) is ignored. */
    answer(id: number, ok: boolean) {
      const head = items[0];
      if (!head || head.dialog.id !== id) return;
      items = items.slice(1);
      head.resolve(ok);
      emit();
    },
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
}

export type DialogQueue = ReturnType<typeof createDialogQueue>;

/** The till page's queue, shown by <DialogHost />. */
export const tillDialogs = createDialogQueue();
export const showAlert = tillDialogs.alert;
export const askConfirm = tillDialogs.confirm;

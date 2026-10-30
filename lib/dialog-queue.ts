/**
 * The till's own alert/confirm, in place of the browser's. Chrome's box says
 * "localhost:3000 says", has English OK/Cancel and looks different in the
 * browser, the exe and the APK; ours matches the rest of the page.
 *
 * Unlike window.confirm this cannot pause the code, so it hands back a promise:
 * `if (!(await askConfirm('…'))) return;`. Popups asked while one is open wait
 * their turn instead of replacing it.
 *
 * The exe has no window.prompt at all (Electron leaves it out), so a typed
 * answer comes through here too: `await tillDialogs.ask('…')`.
 */

export type DialogOptions = {
  /** Label of the confirm button. Defaults to "Bəli". */
  confirmLabel?: string;
};

export type AskOptions = {
  /** Filled in to be corrected. */
  value?: string;
  placeholder?: string;
};

export type QueuedDialog = {
  id: number;
  kind: 'alert' | 'confirm' | 'choose' | 'ask';
  title: string;
  message: string;
  confirmLabel: string;
  /** choose: one button per answer, in order. */
  choices?: string[];
  /** ask: the box's starting text and hint. */
  value?: string;
  placeholder?: string;
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
  let items: { dialog: QueuedDialog; resolve: (answer: unknown) => void }[] = [];
  let nextId = 1;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(fn => fn());

  function push<T>(kind: QueuedDialog['kind'], text: string, extra: Partial<QueuedDialog> = {}): Promise<T> {
    return new Promise<T>(resolve => {
      const dialog = { id: nextId++, kind, ...splitMessage(text), confirmLabel: 'Bəli', ...extra };
      items = [...items, { dialog, resolve: resolve as (answer: unknown) => void }];
      emit();
    });
  }

  return {
    alert: (text: string): Promise<void> => push('alert', text).then(() => undefined),
    confirm: (text: string, opts?: DialogOptions): Promise<boolean> =>
      push<boolean>('confirm', text, opts?.confirmLabel ? { confirmLabel: opts.confirmLabel } : {}),
    /** The index of the button pressed, or null for Ləğv et. */
    choose: (text: string, choices: string[]): Promise<number | null> => push('choose', text, { choices }),
    /** What was typed, or null for Ləğv et. */
    ask: (text: string, opts?: AskOptions): Promise<string | null> =>
      push('ask', text, { confirmLabel: 'Saxla', value: opts?.value ?? '', placeholder: opts?.placeholder }),
    current: (): QueuedDialog | null => items[0]?.dialog ?? null,
    /**
     * Answers the dialog with this id; a stale id (already answered) is ignored.
     * alert/confirm take true/false, choose an index or null, ask a string or null.
     */
    answer(id: number, answer: boolean | number | string | null) {
      const head = items[0];
      if (!head || head.dialog.id !== id) return;
      items = items.slice(1);
      head.resolve(answer);
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

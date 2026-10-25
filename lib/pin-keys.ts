// What a key on a hardware keyboard means on a PIN pad: the staff lock screen
// and the manager's approval box both read keys through this, in the browser
// till, the exe and the APK alike.
//
// The number pad counts with Num Lock off too: its keys then say "End",
// "ArrowDown" and so on, but their code still says which digit they are.

export type PinKey = { digit: string } | 'back' | 'cancel' | null;

export function pinKey(e: Pick<KeyboardEvent, 'key' | 'code'>): PinKey {
  if (/^\d$/.test(e.key)) return { digit: e.key };
  const pad = /^Numpad(\d)$/.exec(e.code ?? '');
  if (pad) return { digit: pad[1] };
  if (e.key === 'Backspace' || e.key === 'Delete') return 'back';
  if (e.key === 'Escape') return 'cancel';
  return null;
}

'use client';

// The first morning, on a till that has just been installed.
//
// One box. The manager pastes the terminal link the admin panel gave them, and
// this machine is that terminal from then on — the PIN pad on every start after,
// including a start with no line (see lib/terminal-link.ts for where it is kept
// and why).
//
// Deliberately the only screen in the desktop app that asks for anything. A till
// on a counter is used by people who do not have the owner's password and should
// not be handed it.

import { useState } from 'react';
import { Link2, Loader2 } from 'lucide-react';
import { checkLink, normalTillNumber, parseTerminalLink, saveLink, type Terminal } from '@/lib/terminal-link';

export default function TillLink({ onLinked }: { onLinked: (t: Terminal) => void }) {
  const [value, setValue] = useState('');
  // Which counter this machine is. One till is the overwhelmingly common case,
  // so 1 is the answer already filled in and most managers will never touch it.
  const [till, setTill] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    const parsed = parseTerminalLink(value);
    if (!parsed) {
      setError('Keçid düzgün deyil. Admin panelindən kopyalayın.');
      return;
    }

    setBusy(true);
    setError('');
    const result = await checkLink(parsed.slug, parsed.token, normalTillNumber(till));
    setBusy(false);

    // The link is checked against the server rather than taken on trust: this is
    // the one moment the machine has nothing, so a wrong link here would fill
    // the local database from the wrong restaurant — or from nothing at all.
    if (result.status === 'invalid') {
      setError('Bu keçid işləmir. Admindən yenisini alın.');
      return;
    }
    if (result.status === 'offline') {
      setError('İnternet yoxdur. Quraşdırma üçün bir dəfə internet lazımdır.');
      return;
    }

    await saveLink(result.terminal);
    onLinked(result.terminal);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50 p-6">
      <form onSubmit={submit} className="w-full max-w-sm">
        <div className="w-11 h-11 rounded-2xl bg-primary-800 flex items-center justify-center mb-4">
          <Link2 className="w-5 h-5 text-white" />
        </div>

        <h1 className="text-lg font-semibold text-stone-800">Kassanı qoşun</h1>
        <p className="mt-1 text-sm text-stone-500 leading-relaxed">
          Admin panelindəki kassa keçidini bura yapışdırın. Bu, yalnız bir dəfə lazımdır —
          sonra proqram birbaşa PIN ekranı ilə açılacaq.
        </p>

        <input
          value={value}
          onChange={e => { setValue(e.target.value); setError(''); }}
          autoFocus
          spellCheck={false}
          placeholder="https://www.possiblle.com/s/..."
          className="mt-5 w-full rounded-xl border border-stone-300 px-3.5 py-3 text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none focus:border-primary-700"
        />

        {/* Only matters in a restaurant with more than one counter, and there it
            matters a great deal: with the line down both tills number their own
            orders, and this is what keeps two №45s apart. Left at 1, nothing
            about the receipt changes. */}
        <label className="mt-3 flex items-center gap-3">
          <span className="text-sm text-stone-600">Bu neçənci kassadır?</span>
          <input
            value={till}
            onChange={e => setTill(e.target.value.replace(/\D/g, '').slice(0, 1))}
            inputMode="numeric"
            className="w-14 rounded-xl border border-stone-300 px-3 py-2 text-sm text-center text-stone-800 focus:outline-none focus:border-primary-700"
          />
        </label>
        <p className="mt-1 text-xs text-stone-400 leading-relaxed">
          Bir kassanız varsa 1 qalsın. İkinci kassada 2 yazın — sifariş nömrələri
          qarışmasın deyə.
        </p>

        <p className={`mt-2 text-sm h-5 ${error ? 'text-red-500' : 'text-transparent'}`}>
          {error || '·'}
        </p>

        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="mt-2 w-full py-3 rounded-xl bg-primary-800 hover:bg-primary-900 disabled:opacity-40 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {busy ? 'Yoxlanılır…' : 'Davam et'}
        </button>

        {/* The owner's own way in, kept for the machine in the office. /login is
            in the bundle, so this works on a till that has never been online —
            signing in, of course, does not. */}
        <a
          href="/login"
          className="mt-4 block text-center text-xs text-stone-400 hover:text-stone-600 transition-colors"
        >
          Hesabla daxil ol
        </a>
      </form>
    </div>
  );
}

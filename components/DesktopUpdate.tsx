'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import type { DesktopUpdate as Update } from '@/lib/desktopPrint';

// The desktop app's "new version" prompt. Renders nothing in a browser, and
// nothing until electron/updater.ts has a verified installer on the disk.
//
// An update that was waiting as the app opened blocks the till until it is
// installed. One that arrives mid-shift is only a banner: a waiter in the middle
// of an order must not be thrown out of it. Next time the app opens, it is
// required.
export default function DesktopUpdate() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const bridge = window.posNative?.update;
    if (!bridge) return;
    void bridge.status().then(s => { if (s) setUpdate(s); });
    return bridge.onReady(setUpdate);
  }, []);

  if (!update) return null;

  const install = () => {
    setInstalling(true);
    void window.posNative?.update?.install();
  };

  const button = (
    <button
      onClick={install}
      disabled={installing}
      className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
    >
      <Download size={18} />
      {installing ? 'Yüklənir…' : 'Yeni versiyanı yüklə'}
    </button>
  );

  if (update.required) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-stone-50 p-6">
        <div className="max-w-sm text-center">
          <h1 className="mb-2 text-xl font-semibold text-stone-800">Yeni versiya hazırdır</h1>
          <p className="mb-6 text-sm leading-relaxed text-stone-500">
            Davam etmək üçün proqramı yeniləyin. Bu, təxminən yarım dəqiqə çəkir —
            proqram özü yenidən açılacaq. Sifarişləriniz itməyəcək.
          </p>
          {button}
          <p className="mt-6 text-xs text-stone-400">v{update.version}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-0 top-0 z-[9999] flex items-center justify-center gap-4 bg-amber-50 px-4 py-2 text-sm text-amber-900 shadow">
      <span>Yeni versiya hazırdır (v{update.version}). Növbəti açılışda məcburi olacaq.</span>
      {button}
    </div>
  );
}

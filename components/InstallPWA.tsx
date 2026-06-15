'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function InstallPWA() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches;
    if (standalone) return;

    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;
    setIsIOS(ios);
    if (ios) { setVisible(true); return; }

    const handler = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-stone-900 text-white px-4 py-3 rounded-2xl shadow-xl text-sm max-w-xs w-full mx-4">
      <Download className="w-4 h-4 shrink-0 text-amber-400" />
      {isIOS ? (
        <span className="flex-1">
          Əlavə et: <span className="font-semibold">Paylaş → Ana ekrana əlavə et</span>
        </span>
      ) : (
        <button
          className="flex-1 text-left"
          onClick={async () => {
            if (!prompt) return;
            await prompt.prompt();
            setVisible(false);
          }}
        >
          Admin paneli <span className="font-semibold text-amber-400">quraşdır</span>
        </button>
      )}
      <button onClick={() => setVisible(false)} className="shrink-0 opacity-60 hover:opacity-100">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

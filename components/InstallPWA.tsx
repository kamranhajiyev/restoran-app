'use client';

import { useEffect, useState, useRef } from 'react';
import { MonitorSmartphone, X, Share } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function InstallPWA() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches;
    if (standalone) return;

    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;
    if (ios) { setIsIOS(true); setReady(true); return; }

    const handler = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
      setReady(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (!ready) return null;

  async function handleInstall() {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') setReady(false);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => isIOS ? setOpen(o => !o) : handleInstall()}
        className="w-9 h-9 flex items-center justify-center rounded-lg text-stone-500 hover:text-primary-700 hover:bg-primary-50 transition-colors"
        title="Tətbiqi quraşdır"
      >
        <MonitorSmartphone className="w-4 h-4" />
      </button>

      {isIOS && open && (
        <div className="absolute right-0 top-11 w-72 bg-white border border-stone-200 rounded-2xl shadow-xl p-4 z-50">
          <div className="flex items-start justify-between gap-2 mb-2">
            <p className="text-sm font-semibold text-stone-800">Telefona əlavə et</p>
            <button onClick={() => setOpen(false)} className="text-stone-400 hover:text-stone-600 shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-stone-500 leading-relaxed">
            Admin panelini ana ekrana əlavə etmək üçün:
          </p>
          <ol className="mt-2 space-y-1.5 text-xs text-stone-600">
            <li className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-primary-100 text-primary-800 text-[10px] font-bold flex items-center justify-center shrink-0">1</span>
              Aşağıdakı <Share className="w-3 h-3 inline mx-0.5 text-blue-500" /> düyməsinə basın
            </li>
            <li className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-primary-100 text-primary-800 text-[10px] font-bold flex items-center justify-center shrink-0">2</span>
              <span><span className="font-medium">Ana ekrana əlavə et</span> seçin</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-primary-100 text-primary-800 text-[10px] font-bold flex items-center justify-center shrink-0">3</span>
              <span><span className="font-medium">Əlavə et</span> düyməsinə basın</span>
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}

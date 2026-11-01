'use client';
import { useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { Eye, LogOut } from 'lucide-react';
import { viewAsLabel } from '@/lib/view-as-session';

// localStorage does not change under a page mid-visit, so nothing to subscribe
// to; the server has no visit, so the bar appears only after hydration.
const noSubscribe = () => () => {};
const noVisit = () => null;

// Shown on every page while the superadmin is inside a restaurant's account.
// "Çıx" is a full load of /superadmin, which puts the superadmin's login back
// (lib/view-as-session).
export default function ViewAsBar() {
  const label = useSyncExternalStore(noSubscribe, viewAsLabel, noVisit);
  // /superadmin is where the visit ends, not part of it.
  const pathname = usePathname();
  if (!label || pathname.startsWith('/superadmin')) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] max-w-[calc(100vw-2rem)] flex items-center gap-3 rounded-full bg-amber-400 text-amber-950 pl-4 pr-1.5 py-1.5 text-sm font-medium shadow-lg">
      <Eye className="w-4 h-4 shrink-0" />
      <span className="truncate">Baxış: <span className="font-semibold">{label}</span></span>
      <a
        href="/superadmin"
        className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-amber-950/10 hover:bg-amber-950/20 px-3 py-1 font-semibold transition-colors"
      >
        <LogOut className="w-3.5 h-3.5" /> Çıx
      </a>
    </div>
  );
}

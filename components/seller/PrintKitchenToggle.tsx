'use client';
import { Printer } from 'lucide-react';

// The till's one say over the kitchen slip. Unticked, the lines this press sends
// are flagged no_print and the print triggers pass them by.
export function PrintKitchenToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-semibold transition-colors ${on ? 'bg-green-50 text-green-700' : 'bg-stone-100 text-stone-500'}`}
    >
      <span className="flex items-center gap-2"><Printer className="w-4 h-4" />Mətbəxə çap et</span>
      <span className={`relative w-9 h-5 rounded-full transition-colors ${on ? 'bg-green-600' : 'bg-stone-300'}`}>
        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

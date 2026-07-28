import { ChevronDown } from 'lucide-react';
import type { FeatureFaq } from '@/lib/features';

// Native <details> rather than useState, for two reasons: the answer text is in the
// HTML whether or not anyone clicks — which is the whole point of putting an FAQ on a
// marketing page — and the accordion needs no client JavaScript at all.
export default function Faq({ items }: { items: FeatureFaq[] }) {
  return (
    <div className="space-y-3">
      {items.map(f => (
        <details
          key={f.q}
          className="group border border-black/10 rounded-xl px-5 py-4 hover:border-black/30 transition-colors"
        >
          <summary className="flex items-center justify-between gap-4 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <h3 className="font-medium text-sm text-gray-900">{f.q}</h3>
            <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <p className="mt-3 text-xs text-gray-500 leading-relaxed">{f.a}</p>
        </details>
      ))}
    </div>
  );
}

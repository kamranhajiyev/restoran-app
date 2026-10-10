'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { searchByName } from '@/lib/az-text';

// A search box that adds what is picked: type part of a name, click a match.
// Used where the list is too long for a dropdown (a set's meals, a recipe's
// ingredients). Lives inside a <form>, so Enter picks the first match instead
// of submitting it.
export default function SearchAdd({ options, placeholder, onPick, none }: {
  options: { id: string; name: string; tag?: string }[];
  placeholder: string;
  onPick: (id: string) => void;
  none: string;   // shown when nothing matches what was typed
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const found = searchByName(options, query);

  function pick(id: string) {
    onPick(id);
    setQuery('');
  }

  return (
    <div className="relative" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5 pointer-events-none" />
      <input
        type="text" value={query} placeholder={placeholder} autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); if (open && found[0]) pick(found[0].id); }
          if (e.key === 'Escape') setOpen(false);
        }}
        className="w-full border border-stone-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-700 bg-white"
      />
      {open && (
        <div className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-stone-200 bg-white divide-y divide-stone-100">
          {found.map(o => (
            <button key={o.id} type="button" onClick={() => pick(o.id)}
              className="w-full flex items-center justify-between gap-3 px-3 py-2 text-sm text-left text-stone-700 hover:bg-primary-50 focus:bg-primary-50 focus:outline-none">
              <span className="min-w-0 break-words">{o.name}</span>
              {o.tag && <span className="text-xs text-stone-400 shrink-0">{o.tag}</span>}
            </button>
          ))}
          {found.length === 0 && <p className="px-3 py-2 text-sm text-stone-400">{none}</p>}
        </div>
      )}
    </div>
  );
}

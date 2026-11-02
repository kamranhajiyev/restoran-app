'use client';

// The small shared furniture of the admin panels — the three class strings and
// the dialog shell that every CRUD list in here is built out of.
//
// Extracted from AnbarPanel when Kuryerlər became a second panel of the same
// shape. Two copies of a button style is how two panels start looking like two
// products; there is nothing here worth having twice.

export const inputCls = 'w-full px-3 py-2 text-sm rounded-lg border border-stone-200 focus:outline-none focus:ring-2 focus:ring-stone-300';
export const btnPrimary = 'inline-flex items-center gap-1.5 px-3.5 py-2 text-sm rounded-lg bg-stone-800 hover:bg-stone-700 text-white font-medium transition-colors disabled:opacity-50';
export const btnGhost = 'inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors';

// One card, one filter shape, one tag. Pages that drew their own drifted a
// border shade or a pixel of height apart, and the admin stopped looking like
// one product.
export const card = 'bg-white rounded-lg border border-stone-200';

// Every filter — preset button, date box, dropdown — is this one height, so a
// filter row reads as one row. Only the colours move with `active`.
export const chipBase = 'h-8 inline-flex items-center gap-1.5 px-3 text-xs font-medium rounded-lg border transition-colors focus:outline-none';
export function chip(active: boolean) {
  return `${chipBase} ${active ? 'bg-primary-800 border-primary-800 text-white' : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50'}`;
}
// A dropdown that is narrowing the list: tinted, not filled, so it never looks
// like the selected period preset next to it.
export function chipSelect(active: boolean) {
  return `${chipBase} ${active ? 'bg-primary-50 border-primary-300 text-primary-900' : 'bg-white border-stone-200 text-stone-600'}`;
}

// Grey unless the tag is a warning. Colour on every tag is how a row ends up
// with five colours and nothing standing out.
export type TagTone = 'neutral' | 'warn' | 'bad' | 'good';
const TAG_TONE: Record<TagTone, string> = {
  neutral: 'bg-stone-100 text-stone-600',
  warn:    'bg-amber-100 text-amber-800',
  bad:     'bg-red-50 text-red-700',
  good:    'bg-green-50 text-green-700',
};
export function tagCls(tone: TagTone = 'neutral') {
  return `inline-flex items-center gap-1 text-[11px] font-medium rounded-md px-1.5 py-0.5 whitespace-nowrap ${TAG_TONE[tone]}`;
}
export function Tag({ tone, title, children }: { tone?: TagTone; title?: string; children: React.ReactNode }) {
  return <span title={title} className={tagCls(tone)}>{children}</span>;
}

// A choice of one among a few (period presets): one grey track, the picked one
// a raised white tab. Reads as one control instead of a row of loose buttons.
// `count` puts a small number after the label (Hamısı 23).
export function Segmented<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string; count?: number }[]; value: T | null; onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex h-9 max-w-full overflow-x-auto items-center gap-0.5 rounded-lg bg-stone-100 p-1">
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`h-7 px-3 shrink-0 inline-flex items-center gap-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all ${value === o.value ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-800'}`}
        >
          {o.label}
          {o.count !== undefined && <span className={`tabular-nums ${value === o.value ? 'text-stone-500' : 'text-stone-400'}`}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

// From–to dates in one box with a calendar icon; ✕ clears when `onClear` is given.
export function DateRange({ from, to, onFrom, onTo, active, onClear }: {
  from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void;
  active?: boolean; onClear?: () => void;
}) {
  return (
    <div className={`h-9 inline-flex items-center gap-2 rounded-lg border px-2.5 transition-colors ${active ? 'bg-primary-50 border-primary-300' : 'bg-white border-stone-200 hover:border-stone-300'}`}>
      <svg className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-primary-700' : 'text-stone-400'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
      <input type="date" value={from} max={to || undefined} onChange={e => onFrom(e.target.value)}
        className="text-xs font-medium text-stone-700 bg-transparent border-none outline-none w-[112px]" />
      <span className="text-stone-300 text-xs">→</span>
      <input type="date" value={to} min={from || undefined} onChange={e => onTo(e.target.value)}
        className="text-xs font-medium text-stone-700 bg-transparent border-none outline-none w-[112px]" />
      {onClear && (from || to) && (
        <button onClick={onClear} title="Tarixi sıfırla"
          className="w-5 h-5 flex items-center justify-center rounded text-stone-400 hover:text-stone-700 hover:bg-stone-100">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      )}
    </div>
  );
}

// The bordered toolbar button (İxrac, Yenilə), as on the seller page.
export const toolBtn = 'h-9 inline-flex items-center gap-1.5 text-sm text-stone-700 hover:text-stone-900 border border-stone-200 rounded-lg px-3 bg-white hover:bg-stone-50 transition-colors whitespace-nowrap disabled:opacity-60';

// The search box of a toolbar.
export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative flex-1 min-w-[180px]">
      <svg className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full h-9 bg-white border border-stone-200 rounded-lg pl-9 pr-3 text-sm text-stone-700 placeholder:text-stone-400 outline-none hover:border-stone-300 focus:border-primary-300" />
    </div>
  );
}

// A dropdown with an icon in front and our own arrow, the browser's arrow hidden.
export function FilterSelect({ icon: Icon, active, value, onChange, children }: {
  icon: React.ComponentType<{ className?: string }>; active: boolean; value: string;
  onChange: (v: string) => void; children: React.ReactNode;
}) {
  return (
    <label className={`relative h-9 inline-flex items-center rounded-lg border transition-colors ${active ? 'bg-primary-50 border-primary-300 text-primary-900' : 'bg-white border-stone-200 text-stone-700 hover:border-stone-300'}`}>
      <Icon className={`pointer-events-none absolute left-2.5 w-3.5 h-3.5 ${active ? 'text-primary-700' : 'text-stone-400'}`} />
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-full appearance-none bg-transparent pl-8 pr-8 text-xs font-medium focus:outline-none cursor-pointer"
      >
        {children}
      </select>
      <svg className="pointer-events-none absolute right-2.5 w-3 h-3 text-stone-400" viewBox="0 0 12 12" fill="none"><path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </label>
  );
}

export function SectionTitle({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return <p className={`text-xs font-semibold text-stone-500 uppercase tracking-wider px-1 ${first ? '' : 'pt-6'}`}>{children}</p>;
}

export function Modal({ title, children, onClose, wide }: {
  title: string; children: React.ReactNode; onClose: () => void; wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className={`bg-white rounded-xl shadow-xl p-6 w-full max-h-[90vh] overflow-y-auto ${wide ? 'max-w-lg' : 'max-w-sm'}`} onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-stone-800 mb-4">{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function Empty({ msg }: { msg: string }) {
  return <div className={`${card} p-8 text-center text-sm text-stone-400`}>{msg}</div>;
}

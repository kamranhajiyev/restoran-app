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

export function Modal({ title, children, onClose, wide }: {
  title: string; children: React.ReactNode; onClose: () => void; wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className={`bg-white rounded-2xl shadow-xl p-6 w-full max-h-[90vh] overflow-y-auto ${wide ? 'max-w-lg' : 'max-w-sm'}`} onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-stone-800 mb-4">{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function Empty({ msg }: { msg: string }) {
  return <div className="bg-white rounded-2xl border border-stone-100 p-8 text-center text-sm text-stone-400">{msg}</div>;
}

'use client';

// A Sifariş növü's QR codes. A type the waiter opens on a table gets one QR
// per table, grouped by hall, so a guest's order lands on their table; any
// other type gets one QR for the whole type, to print or share as a link.
import { useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import { Check, Copy, Printer, X } from 'lucide-react';
import { guestMenuLink } from '@/lib/guest-order';
import { asksForTable, type OrderType } from '@/lib/order-types';
import type { Hall, RestaurantTable } from '@/types';

// `name` is what the box shows; `label` heads the printed page.
type Code = { key: string; name: string; label: string; link: string };

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Prints the given QR boxes, one to a page, each under its label. */
function printCodes(boxes: { label: string; svg: string }[]) {
  if (boxes.length === 0) return;
  const style = document.createElement('style');
  style.textContent = `@media print { body > * { display: none !important; } #__qr-print-area { display: block !important; font-family: sans-serif; } #__qr-print-area section { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; break-after: page; } #__qr-print-area section:last-child { break-after: auto; } #__qr-print-area p { margin: 0 0 16px; font-size: 16px; font-weight: 600; } #__qr-print-area svg { width: 220px; height: 220px; } }`;
  document.head.appendChild(style);
  const area = document.createElement('div');
  area.id = '__qr-print-area';
  area.style.display = 'none';
  area.innerHTML = boxes.map(b => `<section><p>${esc(b.label)}</p>${b.svg}</section>`).join('');
  document.body.appendChild(area);
  window.print();
  document.head.removeChild(style);
  document.body.removeChild(area);
}

export default function OrderTypeQr({ type, slug, tables, halls, tablesOn, onClose }: {
  type: OrderType;
  slug: string;
  tables: RestaurantTable[];
  halls: Hall[];
  tablesOn: boolean;
  onClose: () => void;
}) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const perTable = asksForTable(type, tablesOn);
  const ref = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Halls in their order; tables whose hall is gone go last, unnamed.
  const groups: { name: string; codes: Code[] }[] = perTable
    ? [...[...halls].sort((a, b) => a.position - b.position).map(h => ({ id: h.id as string | undefined, name: h.name })), { id: undefined, name: '' }]
      .map(g => ({
        name: g.name,
        codes: tables
          .filter(t => g.id ? t.hallId === g.id : !halls.some(h => h.id === t.hallId))
          .map(t => ({ key: String(t.id), name: t.name, label: `${type.name} · ${t.name}`, link: guestMenuLink(origin, slug, type.id, t.id) })),
      }))
      .filter(g => g.codes.length > 0)
    : [{ name: '', codes: [{ key: 'type', name: type.name, label: type.name, link: guestMenuLink(origin, slug, type.id) }] }];
  const codes = groups.flatMap(g => g.codes);

  function svgOf(key: string) {
    return ref.current?.querySelector(`[data-qr="${key}"] svg`)?.outerHTML ?? '';
  }

  function print(only?: Code) {
    printCodes((only ? [only] : codes).map(c => ({ label: c.label, svg: svgOf(c.key) })).filter(b => b.svg));
  }

  function copy(c: Code) {
    void navigator.clipboard.writeText(c.link).then(() => {
      setCopied(c.key);
      setTimeout(() => setCopied(k => k === c.key ? null : k), 1500);
    }, () => {});
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-stone-100">
          <div className="min-w-0">
            <h3 className="font-bold text-stone-800 truncate">{type.name} — QR</h3>
            <p className="text-xs text-stone-500">
              {perTable ? 'Hər masaya öz QR-ı: sifariş həmin masaya düşür.' : 'Çap edin və ya linki paylaşın.'} Menyu bu növün qiymətləri ilə açılır.
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg bg-stone-100 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div ref={ref} className="flex-1 overflow-y-auto p-5 space-y-5">
          {codes.length === 0 && (
            <p className="text-sm text-stone-500 text-center py-8">Hələ masa yoxdur. Masalar bölməsində masa əlavə edin.</p>
          )}
          {groups.map((g, i) => (
            <div key={i} className="space-y-2">
              {perTable && <p className="text-xs font-semibold text-stone-500">{g.name || 'Zalsız'}</p>}
              <div className={perTable ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3' : 'flex justify-center'}>
                {g.codes.map(c => (
                  <div key={c.key} className="border border-stone-100 rounded-xl p-3 flex flex-col items-center gap-2">
                    <p className="text-xs font-semibold text-stone-700 text-center truncate w-full">{c.name}</p>
                    <div data-qr={c.key} className="bg-white">
                      <QRCode value={c.link} size={perTable ? 110 : 180} />
                    </div>
                    <div className="flex gap-1.5">
                      <button onClick={() => print(c)} title="Çap et" className="w-8 h-8 flex items-center justify-center rounded-lg bg-stone-100 hover:bg-primary-100 hover:text-primary-800 transition-colors">
                        <Printer className="w-4 h-4" />
                      </button>
                      <button onClick={() => copy(c)} title="Linki kopyala" className="w-8 h-8 flex items-center justify-center rounded-lg bg-stone-100 hover:bg-primary-100 hover:text-primary-800 transition-colors">
                        {copied === c.key ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                    {!perTable && <p className="text-xs text-stone-500 break-all text-center">{c.link}</p>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {perTable && codes.length > 0 && (
          <div className="px-5 py-3 border-t border-stone-100 flex justify-end">
            <button onClick={() => print()} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary-800 text-white text-sm font-semibold hover:bg-primary-900">
              <Printer className="w-4 h-4" />Hamısını çap et ({codes.length})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

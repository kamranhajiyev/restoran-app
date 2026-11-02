'use client';
import { useState, type CSSProperties } from 'react';
import { AlertTriangle, Bike, ChevronDown, MoreHorizontal, Printer } from 'lucide-react';
import { isOrderOpen, type Order, type OrderItem, type OrderStatus } from '@/types';
import OrderItemHistory from '@/components/OrderItemHistory';
import OrderItemsMerged from '@/components/OrderItemsMerged';
import OrderSyncDot from '@/components/OrderSyncDot';
import { orderLabel } from '@/lib/order-label';
import { mergeLines } from '@/lib/add-again';
import { splitPieces } from '@/lib/split-bill';
import { STATUS_COLORS, STATUS_LABELS, WAIT_COLORS, elapsed, orderTotal, waitLevel } from './order-format';
import OrderNote from '@/components/OrderNote';
import { formatTime } from '@/lib/dates';

// ── OrderRow — mobile card + desktop table row ────────────────────────────

// How much of an order is on the counter. The count is what makes a green row
// actionable: "hazır" alone doesn't say whether to pick up the whole tray or one
// plate, and the waiter would have to open every green order to find out.
function ReadyBadge({ progress, allReady }: { progress: { done: number; total: number }; allReady: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${
      allReady ? 'bg-green-600 text-white' : 'bg-green-100 text-green-800 border border-green-300'
    }`}>
      {allReady ? '✓ Hamısı hazır' : `${progress.done}/${progress.total} hazır`}
    </span>
  );
}

export function OrderRow({ order, tableLabel, tz, printFailed, unsent, progress, isItemReady, onReprint, onPay, onCancel, courierName, canPickCourier, onAppend, onMove, onSplit, onReassign, onPrintBill, billBusy, onStatusChange }: {
  order: Order;
  tableLabel: string;
  tz: string;
  printFailed: boolean;
  /** Still only on this machine — the server has not been told about it yet. */
  unsent: boolean;
  progress: { done: number; total: number };
  isItemReady: (item: OrderItem) => boolean;
  onReprint: () => void;
  onPay: () => void;
  onCancel: () => void;
  /** The food came back. Offered only on a closed courier order still carrying
   *  debt — the one case where a paid order may be cancelled. */
  courierName?: string;
  /** Whether a rider may be put on this order at all — a delivery that has one,
   *  or a link order still waiting for its first. Never a table or a takeaway. */
  canPickCourier: boolean;
  onAppend: () => void;
  onMove: () => void;
  /** "Hesabı böl": the table's bill becomes one per guest. */
  onSplit?: () => void;
  /** Hand the delivery to a different rider. Courier orders only. */
  onReassign: () => void;
  onPrintBill: () => void;
  billBusy: boolean;
  onStatusChange: (id: string, s: OrderStatus) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // Where the "⋯" menu sits, or null when closed. Fixed to the window, not the
  // row: inside the order list's card it was cut off at the card's edge. It
  // opens upward when there is no room below.
  const [menuAt, setMenuAt] = useState<CSSProperties | null>(null);
  const menuOpen = menuAt !== null;
  const setMenuOpen = (open: boolean) => { if (!open) setMenuAt(null); };
  function toggleMenu(button: HTMLElement) {
    if (menuAt) { setMenuAt(null); return; }
    const r = button.getBoundingClientRect();
    const right = window.innerWidth - r.right;
    setMenuAt(window.innerHeight - r.bottom < 260
      ? { right, bottom: window.innerHeight - r.top + 4 }
      : { right, top: r.bottom + 4 });
  }
  // One line per dish by default — what's on the table now. The rounds with their
  // times are one tap away, for when the seller needs to know what came later.
  const [byTime, setByTime] = useState(false);
  const items = (
    <>
      {order.items.length > 0 && (
        <div className="flex justify-end -mt-1 mb-1">
          <button
            onClick={e => { e.stopPropagation(); setByTime(t => !t); }}
            className="text-xs font-medium text-stone-500 hover:text-stone-800 underline underline-offset-2"
          >
            {byTime ? 'Birlikdə göstər' : 'Vaxtla göstər'}
          </button>
        </div>
      )}
      {byTime
        ? <OrderItemHistory order={order} tz={tz} isItemReady={isItemReady} />
        : <OrderItemsMerged order={order} isItemReady={isItemReady} />}
    </>
  );
  const total = orderTotal(order);
  // A table's name leads the row; a takeaway, a courier or a link order has none,
  // so its number does.
  const tableFirst = !!tableLabel && !(order.online && !order.tableNumber);
  const wait = isOrderOpen(order) ? waitLevel(order.createdAt) : 'ok';
  // A table bill with more than one piece on it — a single coffee has nothing to split.
  const canSplit = !!onSplit && order.tableNumber !== 0 && splitPieces(order.items).length > 1;
  // "Çoban salatı ×4", not the same name four times over.
  const itemsPreview = mergeLines(order.items, [], {}).lines.map(({ item: oi, quantity }) =>
    (oi.modifiers ? `${oi.menuItem.name} (${oi.modifiers})` : oi.menuItem.name) + (quantity > 1 ? ` ×${quantity}` : '')
  ).join(', ');

  // Green is the only colour on this list, and it means one thing: food is waiting
  // to be carried. Partly green — some sexes done, some not — still calls the waiter
  // over, so both states are marked; only the strength differs.
  const anyReady = progress.done > 0;
  const allReady = progress.total > 0 && progress.done === progress.total;

  return (
    <div id={`order-${order.id}`}>
      {/* Mobile card, washed green end to end — a stripe on the edge was too quiet to
          catch from across the room. Pale, not saturated: the status pill and the red
          "bağla" button still have to read. */}
      <div className={`md:hidden mx-3 my-2 rounded-2xl border shadow-sm overflow-hidden ${anyReady ? 'bg-green-50 border-green-200 border-l-4 border-l-green-500' : 'bg-white border-stone-100'}`}>
        <button
          className="w-full p-4 text-left"
          onClick={() => setExpanded(e => !e)}
        >
          <div className="flex items-start justify-between mb-2">
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <ChevronDown className={`w-3.5 h-3.5 text-stone-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                {tableFirst
                  ? <span className="text-stone-900 font-bold text-sm">{tableLabel}</span>
                  : <span className="text-primary-700 font-bold text-sm">№{orderLabel(order)}</span>}
                <OrderSyncDot unsent={unsent} />
                {!tableFirst && tableLabel && <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 font-semibold text-xs">{tableLabel}</span>}
                {/* A courier order has no table, and the row would otherwise be
                    indistinguishable from a takeaway sitting on the counter. */}
                {courierName && (
                  <span className="flex items-center gap-1 text-stone-800 font-semibold text-sm">
                    <Bike className="w-3.5 h-3.5 text-stone-500" />{courierName}
                  </span>
                )}
                {(order.courierDebt ?? 0) > 0 && (
                  <span className="text-[11px] font-semibold text-red-600 bg-red-50 border border-red-100 rounded px-1.5 py-0.5 tabular-nums">
                    borc {order.courierDebt!.toFixed(2)} ₼
                  </span>
                )}
              </div>
              <p className="text-sm text-stone-500 pl-5">
                {tableFirst && <><span className="text-primary-700 font-medium">№{orderLabel(order)}</span> · </>}
                {formatTime(order.createdAt, tz)} · <span className={WAIT_COLORS[wait]}>{elapsed(order.createdAt)}</span>
              </p>
            </div>
            <div className="text-right">
              <p className="font-bold text-stone-800">{total.toFixed(2)} ₼</p>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[order.status]}`}>{STATUS_LABELS[order.status]}</span>
            </div>
          </div>
          {anyReady && <ReadyBadge progress={progress} allReady={allReady} />}
          {!expanded && <p className="text-sm text-stone-600 truncate">{itemsPreview}</p>}
        </button>

        {/* The kitchen never got this ticket. The waiter has to know — a slip that
            vanishes in silence is worse than having no printer at all. */}
        {printFailed && (
          <div className="mx-4 mb-3 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
            <p className="flex-1 text-xs text-red-700 font-medium">Sexə çıxmadı — printer cavab vermir</p>
            <button
              onClick={onReprint}
              className="shrink-0 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white px-2.5 py-1 rounded-md transition-colors"
            >
              Yenidən çap
            </button>
          </div>
        )}

        {expanded && (
          <div className={`px-4 pb-4 border-t border-stone-100 ${anyReady ? 'bg-green-50/70' : 'bg-stone-50'}`}>
            <div className="pt-3 mb-3">
              {items}
            </div>
            {order.note && <OrderNote note={order.note} className="text-xs text-stone-500 italic mb-3" />}
            {(order.discountAmount ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-lg px-2 py-0.5 mb-3">
                🏷️ -{order.discountAmount!.toFixed(2)} ₼ endirim
              </span>
            )}
            {isOrderOpen(order) && (
              <div className="flex flex-col gap-2 pt-1">
                <button
                  onClick={e => { e.stopPropagation(); onPay(); }}
                  className="w-full bg-primary-800 hover:bg-primary-900 active:scale-95 text-white text-sm font-semibold px-4 py-3 min-h-11 rounded-xl transition-all"
                >
                  Ödəniş
                </button>
                {/* The bill the customer sees, printed while the order is still
                    open — the paper between the kitchen ticket and the receipt. */}
                <button
                  onClick={e => { e.stopPropagation(); onPrintBill(); }}
                  disabled={billBusy}
                  className="w-full flex items-center justify-center gap-1.5 px-4 py-3 min-h-11 rounded-xl border border-emerald-300 text-emerald-700 hover:bg-emerald-50 active:scale-95 disabled:opacity-50 text-sm font-semibold transition-all"
                >
                  <Printer className="w-4 h-4" />{billBusy ? 'Çap olunur…' : 'Çap et'}
                </button>
                <button
                  onClick={e => { e.stopPropagation(); onAppend(); }}
                  className="w-full px-4 py-3 min-h-11 rounded-xl border border-primary-300 text-primary-800 hover:bg-primary-50 active:scale-95 text-sm font-semibold transition-all"
                >
                  Düzəliş
                </button>
                {order.tableNumber !== 0 && (
                  <button
                    onClick={e => { e.stopPropagation(); onMove(); }}
                    className="w-full px-4 py-3 min-h-11 rounded-xl border border-stone-300 text-stone-700 hover:bg-stone-100 active:scale-95 text-sm font-semibold transition-all"
                  >
                    Masanı dəyiş
                  </button>
                )}
                {canSplit && (
                  <button
                    onClick={e => { e.stopPropagation(); onSplit!(); }}
                    className="w-full px-4 py-3 min-h-11 rounded-xl border border-stone-300 text-stone-700 hover:bg-stone-100 active:scale-95 text-sm font-semibold transition-all"
                  >
                    Hesabı böl
                  </button>
                )}
                {canPickCourier && (
                  <button
                    onClick={e => { e.stopPropagation(); onReassign(); }}
                    className="w-full px-4 py-3 min-h-11 rounded-xl border border-stone-300 text-stone-700 hover:bg-stone-100 active:scale-95 text-sm font-semibold transition-all"
                  >
                    {order.courierId ? 'Kuryeri dəyiş' : 'Kuryer təyin et'}
                  </button>
                )}
                <button
                  onClick={e => { e.stopPropagation(); onCancel(); }}
                  className="w-full px-4 py-3 min-h-11 rounded-xl border border-red-200 text-red-500 hover:bg-red-50 active:scale-95 text-sm font-semibold transition-all"
                >
                  Ödənişsiz bağla
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Desktop table row. Keeps a hover of its own — a green row that doesn't
          react under the cursor looks disabled. */}
      <div className={`hidden md:block border-b ${anyReady ? 'bg-green-50 hover:bg-green-100 border-l-4 border-l-green-500' : 'bg-white hover:bg-stone-50'}`}>
        <div
          className="w-full grid grid-cols-[90px_minmax(0,1fr)_130px_310px_110px] gap-4 px-6 py-4 items-center cursor-pointer"
          onClick={() => setExpanded(e => !e)}
        >
          <div>
            <p className="font-semibold text-stone-800 text-sm">
              {formatTime(order.createdAt, tz)}
            </p>
            <p className={`text-sm ${WAIT_COLORS[wait]}`}>{elapsed(order.createdAt)}</p>
          </div>
          <div className="min-w-0">
            {/* The table is what a waiter looks for, so it leads; the number sits
                small underneath. One line however narrow the column: a long name
                ends in "…" rather than stacking the row three lines tall. */}
            <p className="text-base flex items-center gap-1 whitespace-nowrap min-w-0">
              <ChevronDown className={`w-3.5 h-3.5 text-stone-400 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
              {tableFirst
                ? <span className="font-semibold text-stone-900 truncate min-w-0" title={tableLabel}>{tableLabel}</span>
                : <span className="font-semibold text-primary-700 shrink-0">№{orderLabel(order)}</span>}
              <OrderSyncDot unsent={unsent} />
              {!tableFirst && tableLabel && (
                <span className="ml-1.5 px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 font-semibold text-xs truncate">{tableLabel}</span>
              )}
            </p>
            <p className="text-sm text-stone-600 truncate pl-5">
              {tableFirst && <span className="text-primary-700 font-medium">№{orderLabel(order)}</span>}
              {tableFirst && !expanded && ' · '}
              {!expanded && itemsPreview}
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-sm font-semibold px-2.5 py-0.5 rounded-full ${STATUS_COLORS[order.status]}`}>
              {STATUS_LABELS[order.status]}
            </span>
            {anyReady && <ReadyBadge progress={progress} allReady={allReady} />}
            {printFailed && (
              <span title="Sexə çıxmadı — printer cavab vermir" className="flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full">
                <AlertTriangle className="w-3 h-3" /> Çap
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap" onClick={e => e.stopPropagation()}>
            {printFailed && (
              <button onClick={onReprint} className="h-11 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-4 rounded-lg transition-colors whitespace-nowrap">
                Yenidən çap
              </button>
            )}
            {/* What a seller does most to an open table sits on the row, every
                button a finger's size (44px) for the touch tills. "Ödənişsiz bağla"
                lives in the "⋯" menu: a rushed tap on the row can't close an order
                unpaid, and the sheet behind it still asks for a reason. */}
            {isOrderOpen(order) && (
              <>
                <button
                  onClick={onPrintBill}
                  disabled={billBusy}
                  title="Çap et"
                  aria-label="Çap et"
                  className="w-11 h-11 flex items-center justify-center border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 rounded-lg transition-colors"
                >
                  <Printer className="w-5 h-5" />
                </button>
                <button onClick={onAppend} className="h-11 border border-primary-300 text-primary-800 hover:bg-primary-50 text-sm font-semibold px-4 rounded-lg transition-colors whitespace-nowrap">
                  Düzəliş
                </button>
                <button onClick={onPay} className="h-11 bg-primary-800 hover:bg-primary-900 text-white text-sm font-semibold px-5 rounded-lg transition-colors whitespace-nowrap">
                  Ödəniş
                </button>
                <div className="relative">
                  <button
                    onClick={e => toggleMenu(e.currentTarget)}
                    title="Digər"
                    aria-label="Digər"
                    aria-expanded={menuOpen}
                    className="w-11 h-11 flex items-center justify-center border border-stone-300 text-stone-700 hover:bg-stone-100 rounded-lg transition-colors"
                  >
                    <MoreHorizontal className="w-5 h-5" />
                  </button>
                  {menuOpen && (
                    <>
                      <button aria-label="Bağla" className="fixed inset-0 z-20 cursor-default" onClick={() => setMenuOpen(false)} />
                      <div style={menuAt} className="fixed z-30 w-52 bg-white border border-stone-200 rounded-xl shadow-lg py-1">
                        {canSplit && (
                          <button onClick={() => { setMenuOpen(false); onSplit!(); }} className="w-full h-11 text-left px-4 text-sm text-stone-700 hover:bg-stone-50">
                            Hesabı böl
                          </button>
                        )}
                        {order.tableNumber !== 0 && (
                          <button onClick={() => { setMenuOpen(false); onMove(); }} className="w-full h-11 text-left px-4 text-sm text-stone-700 hover:bg-stone-50">
                            Masanı dəyiş
                          </button>
                        )}
                        {canPickCourier && (
                          <button onClick={() => { setMenuOpen(false); onReassign(); }} className="w-full h-11 text-left px-4 text-sm text-stone-700 hover:bg-stone-50">
                            {order.courierId ? 'Kuryeri dəyiş' : 'Kuryer təyin et'}
                          </button>
                        )}
                        {/* Last and set apart: the one item here that loses money. */}
                        <div className="my-1 border-t border-stone-200" />
                        <button onClick={() => { setMenuOpen(false); onCancel(); }} className="w-full h-11 text-left px-4 text-sm font-semibold text-red-600 hover:bg-red-50">
                          Ödənişsiz bağla
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="text-right">
            {(order.discountAmount ?? 0) > 0 && (
              <p className="text-xs text-stone-400 line-through leading-tight">{(total + order.discountAmount!).toFixed(2)} ₼</p>
            )}
            <span className="text-base font-bold text-stone-900">{total.toFixed(2)} ₼</span>
            {(order.discountAmount ?? 0) > 0 && (
              <p className="text-xs text-green-600 font-semibold leading-tight">-{order.discountAmount!.toFixed(2)} ₼</p>
            )}
          </div>
        </div>

        {expanded && (
          <div className={`px-6 pb-4 border-t border-stone-100 ${anyReady ? 'bg-green-50/70' : 'bg-stone-50'}`}>
            <div className="pt-3 mb-3">
              {items}
            </div>
            {order.note && <OrderNote note={order.note} className="text-xs text-stone-500 italic" />}
            {isOrderOpen(order) && (order.tableNumber !== 0 || canPickCourier) && (
              <div className="flex gap-2 pt-3 mt-1 border-t border-stone-200">
                {order.tableNumber !== 0 && (
                  <button
                    onClick={e => { e.stopPropagation(); onMove(); }}
                    className="text-xs font-semibold text-stone-700 border border-stone-300 hover:bg-stone-100 rounded-lg px-3 py-1.5 transition-colors"
                  >
                    Masanı dəyiş
                  </button>
                )}
                {canPickCourier && (
                  <button
                    onClick={e => { e.stopPropagation(); onReassign(); }}
                    className="text-xs font-semibold text-stone-700 border border-stone-300 hover:bg-stone-100 rounded-lg px-3 py-1.5 transition-colors"
                  >
                    {order.courierId ? 'Kuryeri dəyiş' : 'Kuryer təyin et'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

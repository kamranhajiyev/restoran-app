'use client';
import { useState } from 'react';
import { AlertTriangle, Bike, ChevronDown, Printer, Undo2 } from 'lucide-react';
import { isOrderOpen, type Order, type OrderItem, type OrderStatus } from '@/types';
import OrderItemHistory from '@/components/OrderItemHistory';
import OrderItemsMerged from '@/components/OrderItemsMerged';
import OrderSyncDot from '@/components/OrderSyncDot';
import { orderLabel } from '@/lib/order-label';
import { mergeLines } from '@/lib/add-again';
import { STATUS_COLORS, STATUS_LABELS, elapsed, orderTotal } from './order-format';
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

export function OrderRow({ order, tableLabel, tz, printFailed, unsent, progress, isItemReady, onReprint, onPay, onCancel, onReturn, courierName, canPickCourier, onAppend, onMove, onReassign, onPrintBill, billBusy, onStatusChange }: {
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
  onReturn: () => void;
  courierName?: string;
  /** Whether a rider may be put on this order at all — a delivery that has one,
   *  or a link order still waiting for its first. Never a table or a takeaway. */
  canPickCourier: boolean;
  onAppend: () => void;
  onMove: () => void;
  /** Hand the delivery to a different rider. Courier orders only. */
  onReassign: () => void;
  onPrintBill: () => void;
  billBusy: boolean;
  onStatusChange: (id: string, s: OrderStatus) => void;
}) {
  const [expanded, setExpanded] = useState(false);
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
                <span className="text-primary-700 font-bold text-sm">№{orderLabel(order)}</span>
                <OrderSyncDot unsent={unsent} />
                {tableLabel && <span className={order.online && !order.tableNumber ? 'px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 font-semibold text-xs' : 'text-stone-800 font-semibold text-sm'}>{tableLabel}</span>}
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
              <p className="text-xs text-stone-500 pl-5">
                {formatTime(order.createdAt, tz)} · {elapsed(order.createdAt)}
              </p>
            </div>
            <div className="text-right">
              <p className="font-bold text-stone-800">{total.toFixed(2)} ₼</p>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[order.status]}`}>{STATUS_LABELS[order.status]}</span>
            </div>
          </div>
          {anyReady && <ReadyBadge progress={progress} allReady={allReady} />}
          {!expanded && <p className="text-xs text-stone-600 truncate">{itemsPreview}</p>}
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
                  className="w-full bg-primary-800 hover:bg-primary-900 active:scale-95 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-all"
                >
                  Ödəniş
                </button>
                {/* The bill the customer sees, printed while the order is still
                    open — the paper between the kitchen ticket and the receipt. */}
                <button
                  onClick={e => { e.stopPropagation(); onPrintBill(); }}
                  disabled={billBusy}
                  className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-emerald-300 text-emerald-700 hover:bg-emerald-50 active:scale-95 disabled:opacity-50 text-sm font-semibold transition-all"
                >
                  <Printer className="w-4 h-4" />{billBusy ? 'Çap olunur…' : 'Çap et'}
                </button>
                <button
                  onClick={e => { e.stopPropagation(); onAppend(); }}
                  className="w-full px-4 py-2.5 rounded-xl border border-primary-300 text-primary-800 hover:bg-primary-50 active:scale-95 text-sm font-semibold transition-all"
                >
                  Düzəliş
                </button>
                {order.tableNumber !== 0 && (
                  <button
                    onClick={e => { e.stopPropagation(); onMove(); }}
                    className="w-full px-4 py-2.5 rounded-xl border border-stone-300 text-stone-700 hover:bg-stone-100 active:scale-95 text-sm font-semibold transition-all"
                  >
                    Masanı dəyiş
                  </button>
                )}
                {canPickCourier && (
                  <button
                    onClick={e => { e.stopPropagation(); onReassign(); }}
                    className="w-full px-4 py-2.5 rounded-xl border border-stone-300 text-stone-700 hover:bg-stone-100 active:scale-95 text-sm font-semibold transition-all"
                  >
                    {order.courierId ? 'Kuryeri dəyiş' : 'Kuryer təyin et'}
                  </button>
                )}
                <button
                  onClick={e => { e.stopPropagation(); onCancel(); }}
                  className="w-full px-4 py-2.5 rounded-xl border border-red-200 text-red-500 hover:bg-red-50 active:scale-95 text-sm font-semibold transition-all"
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
          className="w-full grid grid-cols-[120px_1fr_140px_420px_110px] gap-4 px-6 py-4 items-center cursor-pointer"
          onClick={() => setExpanded(e => !e)}
        >
          <div>
            <p className="font-semibold text-stone-800 text-sm">
              {formatTime(order.createdAt, tz)}
            </p>
            <p className="text-xs text-stone-500">{elapsed(order.createdAt)}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-stone-800 flex items-center gap-1">
              <ChevronDown className={`w-3.5 h-3.5 text-stone-400 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
              <span className="text-primary-700">№{orderLabel(order)}</span>
              <OrderSyncDot unsent={unsent} />{tableLabel && (order.online && !order.tableNumber
                ? <span className="ml-1.5 px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 font-semibold text-xs">{tableLabel}</span>
                : <>{' › '}<span>{tableLabel}</span></>)}
            </p>
            {!expanded && <p className="text-xs text-stone-500 truncate max-w-xs pl-5">{itemsPreview}</p>}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[order.status]}`}>
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
              <button onClick={onReprint} className="bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors whitespace-nowrap">
                Yenidən çap
              </button>
            )}
            {/* The two things a seller does most to an open table — print the bill,
                add to it — sit on the row itself. "Ödənişsiz bağla" is kept apart at
                the end so a rushed click on "Düzəliş" can't close the order. */}
            {isOrderOpen(order) && (
              <>
                <button
                  onClick={onPrintBill}
                  disabled={billBusy}
                  title="Çap et"
                  aria-label="Çap et"
                  className="border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 p-1.5 rounded transition-colors"
                >
                  <Printer className="w-4 h-4" />
                </button>
                <button onClick={onAppend} className="border border-primary-300 text-primary-800 hover:bg-primary-50 text-xs font-semibold px-3 py-1.5 rounded transition-colors whitespace-nowrap">
                  Düzəliş
                </button>
                <button onClick={onPay} className="bg-primary-800 hover:bg-primary-900 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors whitespace-nowrap">
                  Ödəniş
                </button>
                <button onClick={onCancel} className="ml-4 border border-red-200 text-red-500 hover:bg-red-50 text-xs font-semibold px-3 py-1.5 rounded transition-colors whitespace-nowrap">
                  Ödənişsiz bağla
                </button>
              </>
            )}
            {/* Closed, but the money is still out on a bike and the food is back
                on the counter. Nothing else in this app reopens a paid order. */}
            {order.status === 'ödənilib' && (order.courierDebt ?? 0) > 0 && (
              <button onClick={onReturn} className="flex items-center gap-1 border border-amber-300 text-amber-700 hover:bg-amber-50 text-xs font-semibold px-3 py-1.5 rounded transition-colors whitespace-nowrap">
                <Undo2 className="w-3.5 h-3.5" />Qaytarıldı
              </button>
            )}
          </div>
          <div className="text-right">
            {(order.discountAmount ?? 0) > 0 && (
              <p className="text-xs text-stone-400 line-through leading-tight">{(total + order.discountAmount!).toFixed(2)} ₼</p>
            )}
            <span className="font-bold text-stone-800">{total.toFixed(2)} ₼</span>
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

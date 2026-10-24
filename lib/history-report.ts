// The paper "Hesabat" printed from Tarixçə: the orders in view (the day, or
// the shift picked) summed for the cashier to check the drawer against.
//
// The money lines are historyTotals — the same Nağd / Kart / Kuryer / Cəmi the
// boxes above the list show — so the paper and the screen cannot disagree.

import type { Line } from './raster';
import { WIDTH } from './escpos';
import { historyTotals } from './history-shifts';
import { formatDate, formatDateTime } from './dates';

type ReportOrder = { id: string; status: string; discountAmount?: number; cashAmount?: number; cardAmount?: number;
  courierDebt?: number; courierCash?: number; courierCard?: number };

export type HistoryReport = {
  count: number;      // paid orders
  toplam: number;     // before discounts
  endirim: number;
  cemi: number;       // after discounts — Tarixçə's Cəmi
  nagd: number;
  kart: number;
  kuryer: number;     // deliveries whose money is not back inside the view
  legv: { count: number; sum: number };
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function historyReport<T extends ReportOrder>(
  orders: T[],
  total: (o: T) => number,
  paidInView?: ReadonlySet<string>,
): HistoryReport {
  const t = historyTotals(orders, total, paidInView);
  const paid = orders.filter(o => o.status === 'ödənilib');
  const endirim = paid.reduce((s, o) => s + (o.discountAmount ?? 0), 0);
  // A delivery the rider brought back is closed unpaid like any other. The till
  // has no way to do that any more (the owner deletes it), so it has no line of
  // its own: one that always read 0 only confused people (Natiq, 2026-10-24).
  const cancelled = orders.filter(o => o.status === 'ləğv edildi');
  const sum = (list: T[]) => r2(list.reduce((s, o) => s + total(o), 0));
  return {
    count: paid.length,
    toplam: r2(t.cemi + endirim),
    endirim: r2(endirim),
    cemi: r2(t.cemi),
    nagd: r2(t.nagd),
    kart: r2(t.kart),
    kuryer: r2(t.kuryer),
    legv: { count: cancelled.length, sum: sum(cancelled) },
  };
}

const row = (label: string, amount: string) => `${label}${amount.padStart(WIDTH - label.length)}`;
const money = (n: number) => `${n.toFixed(2)}m`;

export function historyReportLines(r: HistoryReport, head: {
  companyName: string;
  from: string;
  to: string;
  printedBy: string;
  timezone: string;
  shift?: string;      // "Növbə 2" when one shift is picked
}): Line[] {
  const at = (iso: string) => formatDateTime(iso, head.timezone);
  const day = formatDate(head.from, head.timezone);
  const lines: Line[] = [
    { text: `Hesabat ${day}`, big: true, center: true },
    { text: row('Məkan', head.companyName) },
  ];
  if (head.shift) lines.push({ text: row('Növbə', head.shift) });
  lines.push(
    { text: row('Başlanğıc', at(head.from)) },
    { text: row('Son', at(head.to)) },
    { text: row('Çap edən', head.printedBy) },
    { text: '-'.repeat(WIDTH) },
    { text: row('Sifarişlərin sayı', String(r.count)) },
    { text: row('Toplam', money(r.toplam)) },
    { text: row('Endirimlər', r.endirim > 0 ? `-${money(r.endirim)}` : money(0)) },
    { text: row('CƏMİ', money(r.cemi)), big: true },
    { text: '-'.repeat(WIDTH) },
    { text: row('Nağd', money(r.nagd)) },
    { text: row('Kart', money(r.kart)) },
  );
  // Only when there is some, as on the screen: without it Nağd + Kart would not
  // add up to Cəmi.
  if (r.kuryer > 0.005) lines.push({ text: row('Kuryer', money(r.kuryer)) });
  lines.push(
    { text: '-'.repeat(WIDTH) },
    // The till's own words: there is no "ləğv" button anywhere.
    { text: row(`Ödənişsiz bağlanan (${r.legv.count})`, money(r.legv.sum)) },
  );
  return lines;
}

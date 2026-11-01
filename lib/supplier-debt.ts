// What the restaurant owes its suppliers. Moved out of lib/store
// (fetchSupplierLedger, fetchSupplierPayments) and the Bazarlıqlar view
// (components/AnbarPanel) unchanged on 2026-11-01, save rounding to the qəpik.
// Rows must be every receipt and payment — read with lib/read-all.

import type { StockReceipt, SupplierLedger } from '../types';

type ReceiptRow = { supplier_id: string | null; total: unknown; paid_amount: unknown; voided_at: string | null };
type PaymentRow = { supplier_id: string | null; amount: unknown };

const r2 = (n: number) => Math.round(n * 100) / 100 || 0; // never −0

/** Standalone payments (the Ödəniş box) per supplier. */
export function supplierPaid(payments: PaymentRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of payments) if (p.supplier_id) out[p.supplier_id] = (out[p.supplier_id] ?? 0) + Number(p.amount ?? 0);
  for (const id of Object.keys(out)) out[id] = r2(out[id]);
  return out;
}

/** Tədarükçülər: bought (receipts not voided), paid (on the receipt and in
 *  the Ödəniş box) and the debt between them, per supplier. */
export function supplierLedger(receipts: ReceiptRow[], payments: PaymentRow[]): Record<string, SupplierLedger> {
  const out: Record<string, SupplierLedger> = {};
  const ensure = (id: string) => (out[id] ??= { total: 0, paid: 0, debt: 0 });
  for (const r of receipts) {
    if (!r.supplier_id || r.voided_at) continue;
    const l = ensure(r.supplier_id);
    l.total += Number(r.total ?? 0);
    l.paid += Number(r.paid_amount ?? 0);
  }
  for (const p of payments) if (p.supplier_id) ensure(p.supplier_id).paid += Number(p.amount ?? 0);
  for (const l of Object.values(out)) {
    l.total = r2(l.total);
    l.paid = r2(l.paid);
    l.debt = r2(l.total - l.paid);
  }
  return out;
}

/** Bazarlıqlar: what is still owed on each receipt. A supplier's Ödəniş-box
 *  payments are not tied to a receipt, so they clear his receipts oldest
 *  first — paying a supplier clears the debt shown on his purchases too,
 *  matching the Tədarükçülər ledger. */
export function receiptDebts(
  receipts: Pick<StockReceipt, 'id' | 'supplierId' | 'total' | 'paidAmount' | 'createdAt' | 'voidedAt'>[],
  paidBySupplier: Record<string, number>,
): Record<string, number> {
  const pool = { ...paidBySupplier };
  const map: Record<string, number> = {};
  const ordered = [...receipts]
    .filter(r => !r.voidedAt)
    .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  for (const r of ordered) {
    let d = r.total - r.paidAmount;
    const sid = r.supplierId;
    if (sid && (pool[sid] ?? 0) > 0 && d > 0) {
      const applied = Math.min(pool[sid], d);
      d -= applied; pool[sid] -= applied;
    }
    map[r.id] = r2(d);
  }
  return map;
}

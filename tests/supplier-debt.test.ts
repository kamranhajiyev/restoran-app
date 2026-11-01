// What the restaurant owes its suppliers was summed in lib/store (Tədarükçülər)
// and in components/AnbarPanel (Bazarlıqlar), each from one read of at most
// 1000 rows. Since 2026-11-01 the sums are in lib/supplier-debt and the reads
// page through lib/read-all. İXLAS CAFE's 9 receipts checked against the
// database.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { receiptDebts, supplierLedger, supplierPaid } from '@/lib/supplier-debt';

const receipt = (supplier_id: string | null, total: number, paid_amount: number, voided_at: string | null = null) =>
  ({ supplier_id, total, paid_amount, voided_at });

describe('Tədarükçülər', () => {
  it('bought less paid on receipts and in the Ödəniş box; voided receipts left out', () => {
    const ledger = supplierLedger(
      [receipt('et', 300, 100), receipt('et', 200, 0), receipt('et', 999, 0, '2026-10-05'), receipt('su', 40, 40), receipt(null, 50, 0)],
      [{ supplier_id: 'et', amount: 150 }, { supplier_id: 'su', amount: '0' }],
    );
    expect(ledger).toEqual({
      et: { total: 500, paid: 250, debt: 250 },
      su: { total: 40, paid: 40, debt: 0 },
    });
  });

  it('is to the qəpik, not 0.30000000000000004', () => {
    expect(supplierLedger([receipt('a', 0.1, 0), receipt('a', 0.2, 0)], [])).toEqual({ a: { total: 0.3, paid: 0, debt: 0.3 } });
    expect(supplierPaid([{ supplier_id: 'a', amount: 0.1 }, { supplier_id: 'a', amount: 0.2 }])).toEqual({ a: 0.3 });
  });
});

describe('Bazarlıqlar', () => {
  const r = (id: string, supplierId: string, total: number, paidAmount: number, createdAt: string, voidedAt?: string) =>
    ({ id, supplierId, total, paidAmount, createdAt, voidedAt });

  it('a payment clears the oldest receipt first', () => {
    const debts = receiptDebts(
      [r('new', 'et', 100, 0, '2026-10-20'), r('old', 'et', 80, 30, '2026-10-01'), r('gone', 'et', 500, 0, '2026-09-01', '2026-09-02')],
      { et: 70 },
    );
    // old owes 50 → paid off, 20 left for new
    expect(debts).toEqual({ old: 0, new: 80 });
  });

  it('the receipts add up to the ledger’s debt', () => {
    const rows = [r('a', 'et', 300, 100, '2026-10-01'), r('b', 'et', 200, 0, '2026-10-02')];
    const debts = receiptDebts(rows, { et: 150 });
    const ledger = supplierLedger(rows.map(x => receipt('et', x.total, x.paidAmount)), [{ supplier_id: 'et', amount: 150 }]);
    expect(debts.a + debts.b).toBe(ledger.et.debt);
  });
});

describe('no screen sums supplier money on its own or from one read', () => {
  const store = readFileSync('lib/store.ts', 'utf8');
  const fn = (name: string) => store.slice(store.indexOf(`export async function ${name}(`), store.indexOf('\n}\n', store.indexOf(`export async function ${name}(`)));

  it('lib/store and AnbarPanel use lib/supplier-debt', () => {
    expect(fn('fetchSupplierLedger')).toMatch(/return supplierLedger\(/);
    expect(fn('fetchReceiptDebts')).toMatch(/return receiptDebts\(/);
    expect(readFileSync('components/AnbarPanel.tsx', 'utf8')).not.toMatch(/receiptDebts\(/);
  });

  // Bazarlıqlar lists the newest 200 receipts; the debts on them come from
  // every receipt, or past 200 the payments clear the wrong ones.
  it('receipt debts are worked out over every receipt, not the 200 listed', () => {
    expect(fn('fetchReceiptDebts')).not.toMatch(/\.limit\(/);
    expect(readFileSync('components/AnbarPanel.tsx', 'utf8')).toMatch(/fetchReceiptDebts\(\)/);
  });

  it('a failed read keeps what is on screen, not half the debt', () => {
    for (const name of ['fetchSupplierLedger', 'fetchReceiptDebts']) {
      expect(fn(name), name).toMatch(/if \(!receipts \|\| !payments\) return null;/);
      expect(fn(name), name).toMatch(/catch \{ return null; \}/);
    }
    const panel = readFileSync('components/AnbarPanel.tsx', 'utf8');
    expect(panel).toMatch(/if \(l\) setLedger\(l\)/);
    expect(panel).toMatch(/if \(debts\) setEffectiveDebt\(debts\)/);
  });

  it('every read pages', () => {
    for (const name of ['fetchSupplierLedger', 'fetchReceiptDebts']) {
      const body = fn(name);
      expect((body.match(/\.from\('/g) ?? []).length, name).toBe((body.match(/\.range\(a, b\)/g) ?? []).length);
    }
  });
});

// Maliyyə, for real, on "restoran testing", through the real lib/store.ts as
// the owner: accounts and lines add up as the page counts them (lib/finance),
// a save pressed twice is kept once, a line is never rewritten or erased (only
// marked deleted, with the database's own who and when), an account's changes
// are written on it by the database, an account with history cannot be
// deleted, a closed month takes no new line and loses none, and only the
// restaurant's owner sees any of it.
//
// Run in autotest-b, so Kamran test ucun's Maliyyə stays as the owner keeps it
// (a closed month can never be reopened from the page). Everything is named
// "Autotest" and taken out before and after; the closed months are in 2020.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { accountBalances, deletedEntries, financeEntries } from '@/lib/finance';
import { admin, anon, companyA, companyB, ownerA, ownerB, sellerA } from './setup';

vi.mock('@/lib/supabase', async () => ({ supabase: (await import('./setup')).ownerB, isOnline: async () => true }));
const store = await import('@/lib/store');

const NAME = 'Autotest';
const acc = { cash: '', bank: '', empty: '' };
let strangerAccount = '';   // one in Kamran test ucun, to see who can read it

async function cleanUp() {
  const mine = (await admin.from('finance_accounts').select('id').eq('company_id', companyB.id).like('name', `${NAME}%`)).data?.map(a => a.id) ?? [];
  if (mine.length) {
    await admin.from('finance_transactions').delete().in('account_id', mine);
    await admin.from('finance_transactions').delete().in('to_account_id', mine);
    await admin.from('finance_accounts').delete().in('id', mine);
  }
  await admin.from('finance_closings').delete().eq('company_id', companyB.id).like('month', '2020-%');
  await admin.from('finance_accounts').delete().eq('company_id', companyA.id).eq('name', `${NAME} yad hesab`);
}

const idOf = async (name: string) =>
  (await admin.from('finance_accounts').select('id').eq('company_id', companyB.id).eq('name', name).single()).data!.id as string;

async function balances() {
  const data = await store.fetchFinance();
  if (!data) throw new Error('fetchFinance failed');
  return { data, b: accountBalances(data.accounts, financeEntries(data.transactions, data.shifts, data.sources, data.closing), data.closing) };
}

const line = (kind: 'income' | 'expense' | 'transfer', amount: number, extra: Record<string, unknown> = {}) => ({
  id: randomUUID(), kind, get accountId() { return acc.cash; }, amount, category: NAME, happenedAt: new Date().toISOString(), createdBy: 'autotest', ...extra,
});

beforeAll(async () => {
  await cleanUp();
  store.setCompanyContext(companyB.id);
  expect(await store.createFinanceAccount(`${NAME} kassa`, 'cash', 100, 'autotest')).toBeNull();
  expect(await store.createFinanceAccount(`${NAME} bank`, 'bank', 0, 'autotest')).toBeNull();
  expect(await store.createFinanceAccount(`${NAME} boş`, 'cash', 0, 'autotest')).toBeNull();
  acc.cash = await idOf(`${NAME} kassa`);
  acc.bank = await idOf(`${NAME} bank`);
  acc.empty = await idOf(`${NAME} boş`);
  const s = await admin.from('finance_accounts').insert({ company_id: companyA.id, name: `${NAME} yad hesab`, kind: 'cash' }).select('id').single();
  strangerAccount = s.data!.id;
});

afterAll(cleanUp);

describe('Maliyyə', () => {
  const income = line('income', 50);

  it('adds up: 100 to start, +50, −20, 30 moved to the bank', async () => {
    expect(await store.addFinanceTransaction(income)).toBeNull();
    expect(await store.addFinanceTransaction(line('expense', 20))).toBeNull();
    expect(await store.addFinanceTransaction(line('transfer', 30, { toAccountId: acc.bank }))).toBeNull();
    const { b } = await balances();
    expect(b[acc.cash]).toBe(100);
    expect(b[acc.bank]).toBe(30);
  });

  it('keeps a line saved twice once', async () => {
    expect(await store.addFinanceTransaction(income)).toBeNull();
    const { count } = await admin.from('finance_transactions').select('id', { count: 'exact', head: true }).eq('account_id', acc.cash).eq('kind', 'income');
    expect(count).toBe(1);
  });

  it('never rewrites or erases a line: it is marked deleted, by the owner\'s own name', async () => {
    await ownerB.from('finance_transactions').update({ amount: 5000 }).eq('id', income.id);
    await ownerB.from('finance_transactions').delete().eq('id', income.id);
    expect(Number((await admin.from('finance_transactions').select('amount').eq('id', income.id).single()).data!.amount)).toBe(50);

    expect(await store.deleteFinanceTransaction(income.id, 'Başqa ad')).toBeNull();
    const { data: row } = await admin.from('finance_transactions').select('deleted_at, deleted_by').eq('id', income.id).single();
    expect(row!.deleted_at).not.toBeNull();
    expect(row!.deleted_by).toBe('autotest-b-owner');
    // Deleted stays deleted.
    await ownerB.from('finance_transactions').update({ deleted_at: null }).eq('id', income.id);
    expect((await admin.from('finance_transactions').select('deleted_at').eq('id', income.id).single()).data!.deleted_at).not.toBeNull();

    const { data, b } = await balances();
    expect(b[acc.cash]).toBe(50);
    expect(deletedEntries(data.transactions).map(e => e.amount)).toContain(50);
  });

  it('writes every change to an account on it, which the page cannot', async () => {
    expect(await store.updateFinanceAccount(acc.cash, { name: `${NAME} kassa`, kind: 'cash', openingBalance: 500, active: true })).toBeNull();
    const { data: a } = await admin.from('finance_accounts').select('edits').eq('id', acc.cash).single();
    expect(a!.edits).toEqual([expect.objectContaining({ field: 'opening_balance', from: 100, to: 500, by: 'autotest-b-owner' })]);
    expect((await ownerB.from('finance_accounts').update({ edits: [] }).eq('id', acc.cash)).error).not.toBeNull();
    expect((await admin.from('finance_accounts').select('edits').eq('id', acc.cash).single()).data!.edits).toHaveLength(1);
  });

  it('refuses to delete an account with history; a deleted one takes no new line', async () => {
    expect(await store.deleteFinanceAccount(acc.cash, 'autotest')).toMatch(/əməliyyat var/);
    expect((await admin.from('finance_accounts').select('deleted_at').eq('id', acc.cash).single()).data!.deleted_at).toBeNull();

    expect(await store.deleteFinanceAccount(acc.empty, 'autotest')).toBeNull();
    expect(await store.addFinanceTransaction(line('income', 1, { accountId: acc.empty }))).not.toBeNull();
  });
});

describe('a closed month', () => {
  const old = line('income', 7, { happenedAt: '2020-01-10T12:00:00Z' });

  it('closes in order, once, and only when it is over', async () => {
    expect(await store.addFinanceTransaction(old)).toBeNull();
    const jan = { month: '2020-01', until: '2020-02-01T00:00:00Z', moved: { [acc.cash]: 7 }, entries: [] };
    expect(await store.saveFinanceClosings([jan], 'autotest')).toBeNull();
    // A second tab sends it again: the first is kept.
    expect(await store.saveFinanceClosings([{ ...jan, moved: { [acc.cash]: 999 } }], 'autotest')).toBeNull();
    const { data } = await admin.from('finance_closings').select('moved, closed_by').eq('company_id', companyB.id).eq('month', '2020-01').single();
    expect(data).toEqual({ moved: { [acc.cash]: 7 }, closed_by: 'autotest-b-owner' });

    expect(await store.saveFinanceClosings([{ month: '2019-12', until: '2020-01-01T00:00:00Z', moved: {} }], 'autotest')).toMatch(/behind a closed month/);
    const thisMonth = new Date().toISOString().slice(0, 7);
    expect(await store.saveFinanceClosings([{ month: thisMonth, until: new Date().toISOString(), moved: {} }], 'autotest')).toMatch(/not over long enough/);
  });

  it('takes no new line and loses none', async () => {
    expect(await store.addFinanceTransaction(line('expense', 3, { happenedAt: '2020-01-20T12:00:00Z' }))).toMatch(/bağlanmış aya/);
    expect(await store.deleteFinanceTransaction(old.id, 'autotest')).toMatch(/bağlanmış aya/);
    expect((await admin.from('finance_transactions').select('deleted_at').eq('id', old.id).single()).data!.deleted_at).toBeNull();
    // Today is not closed.
    expect(await store.addFinanceTransaction(line('expense', 3))).toBeNull();
  });

  it('is never changed or removed by the owner', async () => {
    await ownerB.from('finance_closings').update({ moved: {} }).eq('company_id', companyB.id).eq('month', '2020-01');
    await ownerB.from('finance_closings').delete().eq('company_id', companyB.id).eq('month', '2020-01');
    const { data } = await admin.from('finance_closings').select('moved').eq('company_id', companyB.id).eq('month', '2020-01').single();
    expect(data!.moved).toEqual({ [acc.cash]: 7 });
  });
});

describe('who sees Maliyyə', () => {
  it('not the seller, another restaurant or a stranger', async () => {
    for (const who of [sellerA, ownerB, anon]) {
      expect((await who.from('finance_accounts').select('id').eq('id', strangerAccount)).data ?? []).toEqual([]);
    }
    for (const who of [ownerA, anon]) {
      expect((await who.from('finance_accounts').select('id').eq('id', acc.cash)).data ?? []).toEqual([]);
      expect((await who.from('finance_transactions').select('id').eq('account_id', acc.cash)).data ?? []).toEqual([]);
      expect((await who.from('finance_closings').select('month').eq('company_id', companyB.id)).data ?? []).toEqual([]);
    }
  });

  it('nobody but the owner writes it', async () => {
    expect((await sellerA.from('finance_accounts').insert({ company_id: companyA.id, name: `${NAME} satıcı`, kind: 'cash' })).error).not.toBeNull();
    expect((await ownerA.from('finance_transactions').insert({
      company_id: companyB.id, kind: 'income', account_id: acc.cash, amount: 1000,
    })).error).not.toBeNull();
    expect((await anon.from('finance_transactions').insert({
      company_id: companyB.id, kind: 'income', account_id: acc.cash, amount: 1000,
    })).error).not.toBeNull();
    expect((await sellerA.rpc('finance_defaults', { p_company_id: companyA.id })).error?.message).toMatch(/owner_only/);
    expect((await ownerA.rpc('finance_defaults', { p_company_id: companyB.id })).error?.message).toMatch(/owner_only/);
    expect((await anon.rpc('finance_defaults', { p_company_id: companyB.id })).error).not.toBeNull();
    const { b } = await balances();
    expect(b[acc.cash]).toBe(454);   // 500 − 20 − 30 − 3, and the closed January's +7 from its closing
  });
});

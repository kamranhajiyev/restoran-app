// Maliyyə (2026-10-13): the owner's money accounts in admin. An account's
// balance is its starting balance, what the owner typed, and what shifts
// brought. One function counts it (lib/finance), and only the owner reaches it.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  accountBalances, accountEditText, accountOffBlock, addMonths, cashStartHint, dueClosings, inClosedMonth, isClosedMonth, monthOf, deletedAccounts, deletedEntries, liveAccounts, dayLabel, entriesBetween, entriesByDay, entriesOfAccount, monthLabel, totalBalance, financeEntries, financeReport, monthRange, parseAmount,
  isInkassasiya, missingDefaults, shiftEntries, sourceAccount, INKASSASIYA,
  type FinanceAccount, type FinanceClosing, type FinanceSource, type FinanceTransaction,
} from '@/lib/finance';
import type { CashShift } from '@/types';

const acc = (id: string, openingBalance = 0, kind: FinanceAccount['kind'] = 'cash'): FinanceAccount =>
  ({ id, name: id, kind, openingBalance, active: true, createdAt: '2026-10-01T00:00:00Z', edits: [] });

const sources: FinanceSource[] = [
  { kind: 'cash', accountId: 'kassa', fromAt: '2026-10-10T00:00:00Z' },
  { kind: 'card', accountId: 'kart', fromAt: '2026-10-10T00:00:00Z' },
];

// Opened with 50, 120 came in over the counter, 35 taken out for ice, 20 put
// in; the drawer should hold 155 and the cashier counted 150.
const shift: CashShift = {
  id: 's1', openedAt: '2026-10-12T05:00:00Z', openedBy: 'Aysel', openingCash: 50,
  closedAt: '2026-10-12T19:00:00Z', closedBy: 'Aysel',
  expectedCash: 155, countedCash: 150, cardSales: 80.4, countedCard: 79.4,
  movements: [
    { id: 'm1', at: '2026-10-12T10:00:00Z', amount: -35, reason: 'buz', by: 'Aysel' },
    { id: 'm2', at: '2026-10-12T11:00:00Z', amount: 20, reason: 'xırda pul', by: 'Aysel' },
  ],
  edits: [],
};

// Natiq, 2026-10-13: Kassa and Maliyyə are two books. Every cash in, cash out,
// rider payback and shortfall of a shift was listed in Maliyyə too. A shift
// reaches Maliyyə in three ways only: its cash and its card money when it
// closes, and inkassasiya when it is written.
describe('a closed shift', () => {
  const lines = shiftEntries(shift, sources);
  const sum = (accountId: string) => lines.filter(l => l.accountId === accountId)
    .reduce((t, l) => t + (l.kind === 'income' ? l.amount : -l.amount), 0);

  it('brings its cash as one line: what was counted, minus what it opened with', () => {
    expect(lines.filter(l => l.accountId === 'kassa').map(l => [l.kind, l.amount, l.category])).toEqual([['income', 100, 'Növbə · nağd']]);
    expect(sum('kassa')).toBe(shift.countedCash! - shift.openingCash);
  });

  it('brings nothing else from Kassa: no cash in, cash out, rider or shortfall line', () => {
    const busy = { ...shift, movements: [...shift.movements, { id: 'p1', at: shift.openedAt, amount: 42.5, reason: 'Kuryer ödənişi', by: 'Kərim' }] };
    for (const s of [shift, busy]) expect(shiftEntries(s, sources).map(l => l.category)).toEqual(['Növbə · nağd', 'Növbə · kart']);
    const src = readFileSync('lib/finance.ts', 'utf8');
    for (const gone of ['Kassa məxarici', 'Kassa mədaxili', 'Kassa fərqi', 'Terminal fərqi', 'Kuryer ödənişi']) expect(src, gone).not.toContain(gone);
  });

  it('that left less cash than it opened with takes the difference off the account', () => {
    const spent = shiftEntries({ ...shift, countedCash: 20 }, sources).find(l => l.accountId === 'kassa')!;
    expect([spent.kind, spent.amount]).toEqual(['expense', 30]);
  });

  it('brings its card money as one line: the terminal\'s own total when the cashier entered it', () => {
    expect(lines.filter(l => l.accountId === 'kart').map(l => [l.kind, l.amount, l.category])).toEqual([['income', 79.4, 'Növbə · kart']]);
    expect(shiftEntries({ ...shift, countedCard: undefined }, sources).find(l => l.accountId === 'kart')!.amount).toBe(80.4);
  });

  it('brings nothing while it is still open', () => {
    expect(shiftEntries({ ...shift, closedAt: undefined, expectedCash: undefined, countedCash: undefined }, sources)).toEqual([]);
  });

  it('closed before the account was chosen brings nothing: old shifts are not added back', () => {
    expect(shiftEntries({ ...shift, closedAt: '2026-10-09T19:00:00Z' }, sources)).toEqual([]);
  });

  it('stays in the account it went to when the owner picks another one later', () => {
    const later: FinanceSource[] = [...sources, { kind: 'cash', accountId: 'seyf', fromAt: '2026-10-13T00:00:00Z' }];
    expect(shiftEntries(shift, later).filter(l => l.accountId === 'seyf')).toEqual([]);
    expect(sourceAccount(later, 'cash', '2026-10-14T00:00:00Z')).toBe('seyf');
    // Turned off: from then on, nowhere.
    const off: FinanceSource[] = [...later, { kind: 'cash', fromAt: '2026-10-15T00:00:00Z' }];
    expect(sourceAccount(off, 'cash', '2026-10-16T00:00:00Z')).toBeUndefined();
  });

  it('cannot be deleted from Maliyyə: its lines carry the shift', () => {
    expect(lines.every(l => l.shiftId === 's1')).toBe(true);
    expect(new Set(lines.map(l => l.id)).size).toBe(lines.length);
  });
});

describe('balances', () => {
  const accounts = [acc('kassa', 100), acc('seyf', 1000), acc('kart', 0, 'card')];
  const tx = (t: Partial<FinanceTransaction> & Pick<FinanceTransaction, 'id' | 'kind' | 'accountId' | 'amount'>): FinanceTransaction =>
    ({ happenedAt: '2026-10-12T20:00:00Z', ...t });
  const transactions = [
    tx({ id: 't1', kind: 'transfer', accountId: 'kassa', toAccountId: 'seyf', amount: 150, category: INKASSASIYA }),
    tx({ id: 't2', kind: 'expense', accountId: 'seyf', amount: 300.1, category: 'İcarə' }),
    tx({ id: 't3', kind: 'income', accountId: 'seyf', amount: 0.2, category: 'Digər gəlir' }),
  ];
  const entries = financeEntries(transactions, [shift], sources);

  it('inkassasiya takes from Kassa what it gives to Seyf', () => {
    const b = accountBalances(accounts, entries);
    expect(b.kassa).toBe(100 + 100 - 150);      // start + the shift's drawer gain − inkassasiya
    expect(b.seyf).toBe(1000 + 150 - 300.1 + 0.2);
    expect(b.kart).toBe(79.4);
    const before = accountBalances(accounts, financeEntries(transactions.slice(1), [shift], sources));
    expect(b.kassa + b.seyf).toBeCloseTo(before.kassa + before.seyf);
  });

  it('are exact to the qəpik', () => {
    const many = Array.from({ length: 30 }, (_, i) => tx({ id: `x${i}`, kind: 'income', accountId: 'kart', amount: 0.1 }));
    expect(accountBalances(accounts, financeEntries(many, [], [])).kart).toBe(3);
  });

  it('the report leaves transfers out of income and expense', () => {
    const r = financeReport(entries);
    expect(r.totalIncome).toBe(100 + 79.4 + 0.2);   // the shift's cash and card money, and what was typed
    expect(r.totalExpense).toBe(300.1);
    // Money in and out is not profit, so the screen does not call anything that.
    expect(r).not.toHaveProperty('profit');
    expect(readFileSync('components/FinancePanel.tsx', 'utf8')).not.toMatch(/Mənfəət/);
    expect([...r.income, ...r.expense].map(x => x.category)).not.toContain(INKASSASIYA);
  });

  it('a month runs by the business day, not by midnight UTC', () => {
    const s = { timezone: 'Asia/Baku', workOpen: '09:00', workClose: '02:00' };
    const { from, to } = monthRange('2026-10', s);
    expect(from).toBe('2026-09-30T22:00:00.000Z');   // 1 Oct 02:00 Baku
    expect(to).toBe('2026-10-31T22:00:00.000Z');
    expect(monthRange('2026-12', s).to).toBe('2026-12-31T22:00:00.000Z');
    expect(entriesBetween(entries, from, to)).toHaveLength(entries.length);
    expect(entriesBetween(entries, to, '2027-01-01T00:00:00Z')).toEqual([]);
  });

  it('the total on top is every account added up', () => {
    const b = accountBalances(accounts, entries);
    expect(totalBalance(b)).toBe(Math.round((b.kassa + b.seyf + b.kart) * 100) / 100);
    expect(totalBalance({ a: 0.1, b: 0.2 })).toBe(0.3);
  });

  it('picking an account shows its lines, a transfer on both sides', () => {
    expect(entriesOfAccount(entries, 'seyf').map(e => e.id)).toEqual(expect.arrayContaining(['t1', 't2', 't3']));
    expect(entriesOfAccount(entries, 'kart').every(e => e.accountId === 'kart')).toBe(true);
    expect(entriesOfAccount(entries)).toHaveLength(entries.length);
  });

  it('lines sit under the day they happened on in Baku, not in UTC', () => {
    const late = [tx({ id: 'n1', kind: 'income', accountId: 'kart', amount: 1, happenedAt: '2026-10-12T21:30:00Z' }),
      tx({ id: 'n2', kind: 'income', accountId: 'kart', amount: 1, happenedAt: '2026-10-12T19:00:00Z' })];
    const days = entriesByDay(financeEntries(late, [], []), 'Asia/Baku');
    expect(days.map(d => [d.day, d.entries.length])).toEqual([['2026-10-13', 1], ['2026-10-12', 1]]);
    expect(dayLabel('2026-10-13')).toBe('13 oktyabr');
  });

  it('the month picker steps over the year end and reads in Azerbaijani', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthLabel('2026-10')).toBe('Oktyabr 2026');
  });

  it('an amount is a positive number to the qəpik', () => {
    expect(parseAmount('12,5')).toBe(12.5);
    expect(parseAmount(' 6.404 ')).toBe(6.4);
    for (const bad of ['', '0', '-5', 'abc', '0.001']) expect(parseAmount(bad), bad).toBeNull();
  });

  it('the account shift money goes to cannot be switched off', () => {
    expect(accountOffBlock('kassa', sources, '2026-10-13T00:00:00Z')).toMatch(/nağd/);
    expect(accountOffBlock('seyf', sources, '2026-10-13T00:00:00Z')).toBeNull();
  });
});

// 2026-10-13: inkassasiya was a button in Maliyyə, but the cash it takes is in
// the open shift's drawer, which Maliyyə does not see until the shift closes.
// Written there it came off the account twice. It is written in Kassa now, and
// Natiq wrote 80 ₼ in an open shift and saw nothing in Maliyyə: it waited for
// the shift to close. It reaches its account the moment it is written.
describe('inkassasiya written in Kassa', () => {
  const withInk: FinanceSource[] = [...sources, { kind: 'inkassasiya', accountId: 'ink', fromAt: '2026-10-10T00:00:00Z' }];
  const ink = { id: 'm3', at: '2026-10-12T15:00:00Z', amount: -60, reason: INKASSASIYA, by: 'Kərim' };
  // The same shift with 60 taken out as inkassasiya: the drawer holds 95.
  const open: CashShift = { ...shift, closedAt: undefined, closedBy: undefined, expectedCash: undefined, countedCash: undefined,
    cardSales: undefined, countedCard: undefined, movements: [...shift.movements, ink] };
  const closed: CashShift = { ...shift, expectedCash: 95, countedCash: 95, movements: open.movements };
  const accounts = [acc('kassa', 50), acc('ink'), acc('kart', 0, 'card')];

  it('is in its account the moment it is written, with the shift still open', () => {
    expect(shiftEntries(open, withInk).map(l => [l.id, l.kind, l.accountId, l.amount, l.category, l.at, l.by]))
      .toEqual([['shift:s1:ink:m3', 'income', 'ink', 60, 'Növbə · inkassasiya', ink.at, 'Kərim']]);
    const b = accountBalances(accounts, financeEntries([], [open], withInk));
    expect([b.ink, b.kassa]).toEqual([60, 50]);   // the cash account waits for the close
  });

  it('is the same one line after the shift closes, and Maliyyə cannot delete it', () => {
    const lines = shiftEntries(closed, withInk).filter(l => l.accountId === 'ink');
    expect(lines.map(l => [l.id, l.amount, l.at])).toEqual([['shift:s1:ink:m3', 60, ink.at]]);
    expect(lines[0].shiftId).toBe('s1');
  });

  it('and the cash line together are what the shift made in cash', () => {
    const b = accountBalances(accounts, financeEntries([], [closed], withInk));
    expect(b.kassa).toBe(closed.countedCash);       // 50 + (95 − 50)
    expect(b.ink).toBe(60);
    // 120 over the counter − 35 for ice + 20 put in = 105 more cash than the shift opened with.
    expect(b.kassa + b.ink - 50).toBe(120 - 35 + 20);
    // Taking it out loses nothing: the same shift without it ends on the same total.
    const untouched = accountBalances(accounts, financeEntries([], [{ ...shift, expectedCash: 155, countedCash: 155 }], withInk));
    expect(totalBalance(b)).toBe(totalBalance(untouched));
  });

  it('goes to the account chosen when it was written, and nowhere when there was none', () => {
    const at = (s: FinanceSource[]) => shiftEntries(closed, s).filter(l => l.category === 'Növbə · inkassasiya').map(l => l.accountId);
    expect(at(sources)).toEqual([]);                                                                            // never chosen
    expect(at([...withInk, { kind: 'inkassasiya', fromAt: '2026-10-11T00:00:00Z' }])).toEqual([]);                // turned off before
    expect(at([...sources, { kind: 'inkassasiya', accountId: 'ink', fromAt: '2026-10-12T16:00:00Z' }])).toEqual([]); // chosen an hour after
    expect(at([...withInk, { kind: 'inkassasiya', accountId: 'seyf', fromAt: '2026-10-12T16:00:00Z' }])).toEqual(['ink']); // changed later
    // The cash line is the same either way.
    expect(shiftEntries(closed, sources).find(l => l.accountId === 'kassa')!.amount).toBe(45);
  });

  it('is told by its reason, however the word was typed, and only when cash went out', () => {
    for (const reason of [INKASSASIYA, 'inkassasiya', ' INKASSASIYA ', 'İNKASSASİYA']) expect(isInkassasiya({ amount: -5, reason }), reason).toBe(true);
    expect(isInkassasiya({ amount: 5, reason: INKASSASIYA })).toBe(false);
    expect(isInkassasiya({ amount: -5, reason: 'buz' })).toBe(false);
    expect(isInkassasiya({ amount: -5, reason: 'inkassasiya üçün çanta' })).toBe(false);
  });

  it('has its own button in the open shift, on the till and in admin, and both write the same entry', () => {
    const seller = readFileSync('app/seller/page.tsx', 'utf8');
    expect(seller).toContain(`movKind === 'ink' ? '${INKASSASIYA}' : movReason.trim()`);
    expect(seller).toMatch(/amount: movKind === 'in' \? raw : -raw, reason,/);
    // Not behind "+ Əlavə et".
    expect(seller).toMatch(/onClick=\{\(\) => \{ setMovKind\('ink'\); setShowMovForm\(true\); \}\}/);
    // The exe keeps the movement as the page sent it.
    expect(readFileSync('electron/till-write.ts', 'utf8')).toMatch(/movements: \[\.\.\.shift\.movements, movement\]/);

    const admin = readFileSync('app/admin/page.tsx', 'utf8');
    expect(admin).toContain(`amount: -amount, reason: '${INKASSASIYA}', by: adminName`);
    expect(admin).toMatch(/onClick=\{\(\) => handleAdminInkassasiya\(open\)\}/);
    // Sent once, and "written" only when it is read back from the shift.
    expect(admin).toMatch(/if \(!before\.movements\.some\(m => m\.id === id\)\) \{\s+await addShiftMovement\(/);
    expect(admin).toMatch(/if \(after\?\.movements\.some\(m => m\.id === id\)\) \{ inkId\.current = null;/);

    // Maliyyə has no inkassasiya button of its own.
    const panel = readFileSync('components/FinancePanel.tsx', 'utf8');
    expect(panel).not.toMatch(/setTxForm\('ink'\)/);
    expect(panel).toMatch(/type FormKind = 'income' \| 'expense' \| 'transfer';/);
  });

  it('the account it goes to cannot be switched off', () => {
    expect(accountOffBlock('ink', withInk, '2026-10-13T00:00:00Z')).toMatch(/inkassasiya/);
    expect(accountOffBlock('ink', sources, '2026-10-13T00:00:00Z')).toBeNull();
  });

  it('the starting accounts are made once: all three on a first visit, only İnkassasiya for an owner with their own', () => {
    expect(missingDefaults([], [])).toBe(true);
    expect(missingDefaults([acc('kassa')], sources)).toBe(true);
    expect(missingDefaults([acc('kassa'), acc('ink')], withInk)).toBe(false);
    // Turned off by the owner: the row is still the mark, nothing is made again.
    expect(missingDefaults([acc('kassa')], [...sources, { kind: 'inkassasiya', fromAt: '2026-10-11T00:00:00Z' }])).toBe(false);

    const sql = readFileSync('supabase/migrations/20261020_finance_inkassasiya.sql', 'utf8');
    expect(sql).toMatch(/check \(kind in \('cash', 'card', 'inkassasiya'\)\)/);
    expect(sql).toMatch(/if not exists \(select 1 from finance_accounts where company_id = p_company_id\) then/);
    expect(sql).toMatch(/if not exists \(select 1 from finance_sources where company_id = p_company_id and kind = 'inkassasiya'\) then/);
    for (const name of ['Nağd', 'Bank', 'İnkassasiya']) expect(sql, name).toContain(`'${name}'`);
    // Only the owner, never the public key or a cashier login.
    // A cashier's "no owner company" compares as null, and null has to refuse as well.
    expect(sql).toMatch(/if not coalesce\(\(p_company_id = get_my_owner_company_id\(\)\) or is_superadmin\(\), false\) then\s+raise exception 'owner_only'/);
    expect(sql).toMatch(/revoke all on function public\.finance_defaults\(uuid, text\) from public, anon;/);
    expect(sql).not.toMatch(/^grant [^;]* to [^;]*\b(anon|public)\b/m);
    // The page asks the database, and only when something is missing.
    const panel = readFileSync('components/FinancePanel.tsx', 'utf8');
    expect(panel).toMatch(/if \(next && missingDefaults\(next\.accounts, next\.sources\)\) \{\s+made = await ensureFinanceDefaults\(me\);/);
  });
});

// Natiq, 2026-10-13: a shift closed with 500 ₼, the next opened with 100, and
// the cash account fell to 100 with a line "Kassadan götürülüb, yazılmayıb
// 400". The money reaches the account once, when the shift closes; what the
// next shift opens with is Kassa's business and changes nothing here.
describe('a shift may open with any amount', () => {
  const sh = (id: string, openedAt: string, closedAt: string | undefined, openingCash: number, countedCash?: number): CashShift => ({
    id, openedAt, openedBy: 'Kərim', openingCash, closedAt, closedBy: closedAt ? 'Kərim' : undefined,
    expectedCash: countedCash, countedCash, cardSales: closedAt ? 0 : undefined, movements: [], edits: [],
  });
  const first = sh('a', '2026-10-13T05:00:00Z', '2026-10-13T10:00:00Z', 0, 500);
  const nagd = (shifts: CashShift[]) => accountBalances([acc('kassa')], financeEntries([], shifts, sources)).kassa;

  it('the cash account does not move when the next shift opens with less, or with more', () => {
    expect(nagd([first])).toBe(500);
    for (const opening of [100, 0, 500, 800]) {
      const next = sh('b', '2026-10-13T11:00:00Z', undefined, opening);
      expect(nagd([first, next]), `opened with ${opening}`).toBe(500);
      expect(financeEntries([], [first, next], sources).map(e => e.id)).toEqual(['shift:a:cash']);
    }
  });

  it('and when that shift closes it adds only what it made', () => {
    // Opened with 100 of the 500, took 200 over the counter: 300 in the drawer.
    expect(nagd([first, sh('b', '2026-10-13T11:00:00Z', '2026-10-13T19:00:00Z', 100, 300)])).toBe(700);
  });

  it('Maliyyə no longer asks where cash between two shifts went', () => {
    const panel = readFileSync('components/FinancePanel.tsx', 'utf8');
    for (const gone of ['Hara getdi', 'yazılmamış', 'GapForm']) expect(panel, gone).not.toContain(gone);
    expect(readFileSync('lib/finance.ts', 'utf8')).not.toMatch(/gapEntries|yazılmayıb/);
  });
});

// Code review, 2026-10-13: a deleted line was erased, and a starting balance
// could be changed with nothing to show it.
describe('nothing about money disappears without a trace', () => {
  const accounts = [acc('seyf', 1000)];
  const live: FinanceTransaction = { id: 'a', kind: 'expense', accountId: 'seyf', amount: 100, category: 'İcarə', happenedAt: '2026-10-12T10:00:00Z' };
  const gone: FinanceTransaction = { id: 'b', kind: 'expense', accountId: 'seyf', amount: 400, category: 'Maaş', happenedAt: '2026-10-12T11:00:00Z',
    deletedAt: '2026-10-13T09:00:00Z', deletedBy: 'Test Owner' };

  it('a deleted line counts in no balance and no report', () => {
    const entries = financeEntries([live, gone], [], []);
    expect(entries.map(e => e.id)).toEqual(['a']);
    expect(accountBalances(accounts, entries).seyf).toBe(900);
    expect(financeReport(entries).totalExpense).toBe(100);
  });

  it('but stays in Silinənlər with who deleted it and when', () => {
    expect(deletedEntries([live, gone]).map(e => [e.id, e.amount, e.deletedBy, e.deletedAt])).toEqual([['b', 400, 'Test Owner', '2026-10-13T09:00:00Z']]);
  });

  it('a change to an account reads in words', () => {
    expect(accountEditText({ at: '', by: '', field: 'opening_balance', from: 500, to: 5000 })).toBe('Başlanğıc qalıq: 500.00 ₼ → 5000.00 ₼');
    expect(accountEditText({ at: '', by: '', field: 'active', from: true, to: false })).toBe('Vəziyyət: aktiv → söndürülüb');
  });

  it('the database keeps the trace itself: the browser can neither erase a line nor rewrite one', () => {
    const sql = readFileSync('supabase/migrations/20261017_finance_trace.sql', 'utf8');
    expect(sql).toMatch(/revoke delete, update on public\.finance_transactions from authenticated/);
    expect(sql).toMatch(/grant update \(deleted_at, deleted_by\) on public\.finance_transactions to authenticated/);
    expect(sql).toMatch(/grant update \(name, kind, opening_balance, active\) on public\.finance_accounts to authenticated/);
    expect(sql).toMatch(/select name from profiles where id = auth\.uid\(\)/);
    const store = readFileSync('lib/store.ts', 'utf8');
    expect(store).not.toMatch(/from\('finance_transactions'\)\s*\.delete\(/);
  });
});

// An account nothing pointed at was erased in one click: its starting balance
// left Cəmi pul with nothing written, and nothing asked first.
describe('a deleted account', () => {
  const seyf = acc('seyf', 1000);
  const old: FinanceAccount = { ...acc('köhnə', 3000), deletedAt: '2026-10-13T09:00:00Z', deletedBy: 'Test Owner' };

  it('is in no list and no total, and stays in Silinənlər with who and when', () => {
    expect(liveAccounts([seyf, old]).map(a => a.id)).toEqual(['seyf']);
    expect(totalBalance(accountBalances(liveAccounts([seyf, old]), []))).toBe(1000);
    expect(deletedAccounts([seyf, old]).map(a => [a.id, a.openingBalance, a.deletedBy])).toEqual([['köhnə', 3000, 'Test Owner']]);
  });

  it('is marked by the database, never erased, and only when nothing ever touched it', () => {
    const sql = readFileSync('supabase/migrations/20261018_finance_account_delete.sql', 'utf8');
    expect(sql).toMatch(/revoke delete on public\.finance_accounts from authenticated/);
    expect(sql).toMatch(/grant update \(deleted_at, deleted_by\) on public\.finance_accounts to authenticated/);
    expect(sql).toMatch(/from finance_transactions t where t\.account_id = old\.id or t\.to_account_id = old\.id/);
    expect(sql).toMatch(/from finance_sources s where s\.account_id = old\.id/);
    expect(readFileSync('lib/store.ts', 'utf8')).not.toMatch(/from\('finance_accounts'\)\s*\.delete\(/);
  });

  it('the screen asks before deleting and counts only the live accounts', () => {
    const panel = readFileSync('components/FinancePanel.tsx', 'utf8');
    expect(panel).toMatch(/Bəli, sil/);
    expect(panel.match(/deleteFinanceAccount\(/g)).toHaveLength(1);
    expect(panel).toMatch(/accountBalances\(liveAccounts\(data\.accounts\), entries, data\.closing\)/);
  });
});

// Nagd only follows the drawer when it starts from what the first shift opened
// with, and the form said nothing about it.
describe('the starting balance of the cash account', () => {
  it('with a shift open it is that shift\'s opening cash, not the cash in the drawer now', () => {
    const open: CashShift = { id: 's9', openedAt: '2026-10-13T05:00:00Z', openedBy: 'Aysel', openingCash: 80, movements: [], edits: [] };
    expect(cashStartHint([shift, open])).toContain('80.00 ₼');
    expect(cashStartHint([shift, open])).toContain('İndi kassada olan pulu yazmayın');
    // That is the number that makes the account end on what the drawer holds.
    const closed = { ...open, closedAt: '2026-10-13T19:00:00Z', closedBy: 'Aysel', expectedCash: 300, countedCash: 300, cardSales: 0 };
    const from = [{ kind: 'cash' as const, accountId: 'kassa', fromAt: '2026-10-13T12:00:00Z' }];
    expect(accountBalances([acc('kassa', 80)], financeEntries([], [closed], from)).kassa).toBe(300);
  });

  it('with no shift open it is the cash in the drawer now', () => {
    expect(cashStartHint([shift])).toContain('kassada indi olan nağd pulu sayıb yazın');
  });

  it('the open shift is read even before any account takes shift money, and the hint is on the screen', () => {
    expect(readFileSync('lib/store.ts', 'utf8')).toMatch(/q\.is\('closed_at', null\)/);
    expect(readFileSync('components/FinancePanel.tsx', 'utf8').match(/>\{startHint\}<\/p>/g)).toHaveLength(2);
  });
});

// Every balance was counted from every shift since the first day, each time
// the page opened, and a shift corrected in Kassa changed a month long over.
describe('a month that has ended is closed', () => {
  const tz = { timezone: 'Asia/Baku', workOpen: '00:00', workClose: '00:00' };
  const from: FinanceSource[] = [{ kind: 'cash', accountId: 'kassa', fromAt: '2026-07-01T00:00:00Z' }];
  const sh = (id: string, openedAt: string, closedAt: string | undefined, openingCash: number, countedCash?: number): CashShift => ({
    id, openedAt, openedBy: 'Aysel', openingCash, closedAt, closedBy: closedAt ? 'Aysel' : undefined,
    expectedCash: countedCash, countedCash, cardSales: closedAt ? 0 : undefined, movements: [], edits: [],
  });
  // August counted 200. The next shift opens on the 31st and closes in
  // September with 320; the one after opens with 170.
  const aug = sh('a', '2026-08-10T05:00:00Z', '2026-08-10T19:00:00Z', 0, 200);
  const span = sh('b', '2026-08-31T15:00:00Z', '2026-09-01T02:00:00Z', 200, 320);
  const sep = sh('c', '2026-09-20T05:00:00Z', '2026-09-20T19:00:00Z', 170, 400);
  const oct = sh('d', '2026-10-05T05:00:00Z', '2026-10-05T19:00:00Z', 400, 450);
  const tx: FinanceTransaction[] = [
    { id: 't1', kind: 'expense', accountId: 'kassa', amount: 30, category: 'İcarə', happenedAt: '2026-08-15T10:00:00Z' },
    { id: 't2', kind: 'transfer', accountId: 'kassa', toAccountId: 'seyf', amount: 100, happenedAt: '2026-09-25T10:00:00Z' },
    { id: 't3', kind: 'expense', accountId: 'seyf', amount: 10, category: 'Təmir', happenedAt: '2026-10-06T10:00:00Z' },
  ];
  const accounts = [acc('kassa', 0), acc('seyf', 500)];
  const shifts = [aug, span, sep, oct];
  const all = financeEntries(tx, shifts, from);
  const due = dueClosings(all, undefined, '2026-10', tz);
  const last = due[due.length - 1];

  it('this month and the one before stay open; the rest close, oldest first', () => {
    expect(due.map(c => c.month)).toEqual(['2026-08']);
    expect(dueClosings(all, undefined, '2026-11', tz).map(c => c.month)).toEqual(['2026-08', '2026-09']);
    expect(dueClosings(all, undefined, '2026-09', tz)).toEqual([]);
    expect(dueClosings([], undefined, '2026-10', tz)).toEqual([]);
  });

  it('a closing holds the month\'s lines and what each account moved by its end', () => {
    expect(last.until).toBe(monthRange('2026-08', tz).to);
    expect(last.entries!.map(e => e.id).sort()).toEqual(['shift:a:cash', 't1']);
    expect(last.moved).toEqual({ kassa: 170 });
  });

  it('balances from the closing and what came after are the same as counting everything', () => {
    const whole = accountBalances(accounts, all);
    for (const now of ['2026-10', '2026-11', '2027-03']) {
      const closing = dueClosings(all, undefined, now, tz).pop()!;
      // What the page reads once the month is closed: nothing dated before its end.
      const open = financeEntries(tx.filter(t => t.happenedAt >= closing.until),
        shifts.filter(x => !x.closedAt || x.closedAt >= closing.until), from, closing);
      expect(accountBalances(accounts, open, closing), now).toEqual(whole);
    }
    expect(whole).toEqual({ kassa: 470, seyf: 590 });
  });

  it('closing month by month gives the same as closing them all at once', () => {
    const first = dueClosings(all, undefined, '2026-10', tz).pop()!;
    const open = financeEntries(tx.filter(t => t.happenedAt >= first.until), shifts.filter(x => x.closedAt! >= first.until), from, first);
    const second = dueClosings(open, first, '2026-11', tz);
    const atOnce = dueClosings(all, undefined, '2026-11', tz).pop()!;
    expect(second.map(c => c.month)).toEqual(['2026-09']);
    expect(second[0].moved).toEqual(atOnce.moved);
    expect(second[0].entries!.map(e => e.id).sort()).toEqual(atOnce.entries!.map(e => e.id).sort());
  });

  it('a shift corrected after its month closed no longer changes that month', () => {
    const closing = last;
    const fixed = [{ ...aug, expectedCash: 900, countedCash: 900 }, span, sep, oct];
    const open = financeEntries(tx, fixed.filter(x => x.closedAt! >= closing.until), from, closing);
    expect(accountBalances(accounts, open, closing)).toEqual(accountBalances(accounts, all));
  });

  it('nothing is written into a closed month', () => {
    const closing: FinanceClosing = { month: '2026-08', until: '2026-08-31T20:00:00+00:00', moved: {} };
    expect(inClosedMonth('2026-08-31T19:59:59.000Z', closing)).toBe(true);
    // The same instant written the two ways the database and the browser write it.
    expect(inClosedMonth('2026-08-31T20:00:00.000Z', closing)).toBe(false);
    expect(inClosedMonth('2026-08-31T19:59:59.000Z')).toBe(false);
    expect(isClosedMonth('2026-08', closing)).toBe(true);
    expect(isClosedMonth('2026-09', closing)).toBe(false);
    expect(monthOf('2026-08-31T21:00:00Z', tz)).toBe('2026-09');
  });

  it('the database keeps a closing as it was written, and the closed month shut', () => {
    const sql = readFileSync('supabase/migrations/20261019_finance_closings.sql', 'utf8');
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/revoke all on public\.finance_closings from anon, authenticated/);
    expect(sql).toMatch(/grant select, insert on public\.finance_closings to authenticated/);
    expect(sql).not.toMatch(/grant[^;]*(update|delete)[^;]*finance_closings/);
    expect(sql).toMatch(/before insert or update on public\.finance_transactions/);
    expect(sql).toMatch(/now\(\) - interval '28 days'/);
  });

  it('the page reads only from the newest closing on, and saves a closing only from a full read', () => {
    const store = readFileSync('lib/store.ts', 'utf8');
    expect(store).toMatch(/happened_at\.gte\.\$\{until\},deleted_at\.not\.is\.null/);
    expect(store).toMatch(/until > first \? until : first/);
    const panel = readFileSync('components/FinancePanel.tsx', 'utf8');
    expect(panel).toMatch(/if \(next\) \{[\s\S]*?dueClosings\(/);
    expect(panel).toMatch(/accountBalances\(liveAccounts\(data\.accounts\), entries, data\.closing\)/);
  });
});

describe('who reaches Maliyyə', () => {
  const sql = readFileSync('supabase/migrations/20261015_finance.sql', 'utf8');
  const tables = ['finance_accounts', 'finance_transactions', 'finance_sources'];

  it('only the owner: every table is locked to the owner, and the public key gets nothing', () => {
    for (const t of tables) {
      expect(sql, t).toContain(`alter table public.${t} enable row level security`);
      const policies = [...sql.matchAll(new RegExp(`create policy \\w+ on public\\.${t} [^;]*;`, 'g'))].map(m => m[0]);
      expect(policies.length, t).toBeGreaterThan(0);
      for (const p of policies) {
        expect(p, t).toContain('get_my_owner_company_id()');
        expect(p, t).not.toMatch(/get_my_company_id\(\)/);
      }
    }
    expect(sql).toMatch(/revoke all on public\.finance_accounts, public\.finance_transactions, public\.finance_sources from anon, authenticated/);
    expect(sql).not.toMatch(/^grant [^;]*\banon\b/m);
  });

  it('a transaction can only point at an account of its own company', () => {
    expect(sql).toMatch(/foreign key \(account_id, company_id\) references public\.finance_accounts \(id, company_id\)/);
    expect(sql).toMatch(/foreign key \(to_account_id, company_id\) references public\.finance_accounts \(id, company_id\)/);
  });

  it('the cashier and kitchen screens never touch it', () => {
    for (const file of ['app/seller/page.tsx', 'app/station/page.tsx']) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/[Ff]inance/);
    }
  });

  it('the screen counts nothing itself', () => {
    const panel = readFileSync('components/FinancePanel.tsx', 'utf8');
    for (const fn of ['accountBalances', 'financeEntries', 'financeReport']) expect(panel).toContain(`${fn}(`);
    expect(panel).not.toMatch(/\.reduce\(/);
    // A failed read is not an empty Maliyyə.
    expect(readFileSync('lib/store.ts', 'utf8')).toMatch(/if \(!accounts \|\| !transactions \|\| !sources\) return null/);
  });
});

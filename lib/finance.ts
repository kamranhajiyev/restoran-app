// Maliyyə — the owner's money accounts (admin only).
//
// An account's balance is what it started with, plus what the owner entered by
// hand, plus the money closed shifts brought. Shift money is not copied into a
// table: it is read from the shift each time, so correcting a shift in Kassa
// corrects the account too. Every number on the Maliyyə screen comes from here.

import type { CashShift } from '@/types';
import { businessDayStartUtc, tzDateStr, type CompanySettings } from './business-day';

export type AccountKind = 'cash' | 'card' | 'bank';
export type SourceKind = 'cash' | 'card';
export type EntryKind = 'income' | 'expense' | 'transfer';

export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = { cash: 'Nağd', card: 'Kart', bank: 'Bank' };

export interface FinanceAccount {
  id: string;
  name: string;
  kind: AccountKind;
  openingBalance: number;
  active: boolean;
  createdAt: string;
  /** Every change made to the account, written by the database. */
  edits: AccountEdit[];
  /** Deleted: it counts nowhere, and stays in Silinənlər with who and when. */
  deletedAt?: string;
  deletedBy?: string;
}

export interface AccountEdit {
  at: string;
  by: string;
  field: 'opening_balance' | 'name' | 'kind' | 'active';
  from: string | number | boolean;
  to: string | number | boolean;
}

export interface FinanceTransaction {
  id: string;
  kind: EntryKind;
  accountId: string;
  toAccountId?: string; // transfer only
  amount: number;       // always positive
  category?: string;
  note?: string;
  happenedAt: string;
  createdBy?: string;
  /** The owner's answer to a gap: the shift whose opening showed it. */
  gapShiftId?: string;
  /** Deleted: it counts nowhere, and stays in Silinənlər with who and when. */
  deletedAt?: string;
  deletedBy?: string;
}

/** From `fromAt` on, shift cash (or card) money goes to this account; none when the owner turned it off. */
export interface FinanceSource {
  kind: SourceKind;
  accountId?: string;
  fromAt: string;
}

/** One line of the Maliyyə list: typed by the owner, or brought by a closed shift. */
export interface FinanceEntry {
  id: string;
  at: string;
  kind: EntryKind;
  accountId: string;
  toAccountId?: string;
  amount: number;
  title: string;
  category: string;
  by?: string;
  /** Set on a line a shift brought: it cannot be deleted here, only corrected in Kassa. */
  shiftId?: string;
  /** Set on cash that moved between two shifts with nothing written: the owner still has to say where. */
  gapShiftId?: string;
  /** What the shift before counted and what this one opened with. */
  gap?: { counted: number; opened: number };
  deletedAt?: string;
  deletedBy?: string;
  /** Read from a closed month: it can no longer be deleted or answered. */
  closed?: boolean;
}

/**
 * A closed month: its lines and where every account stood at its end, saved
 * once and never counted again. The screen then reads this and the months
 * still open, not every shift since the first day, and a shift corrected later
 * cannot change a month that is closed.
 */
export interface FinanceClosing {
  month: string;  // 'YYYY-MM'
  /** The month's end: everything before it is closed. */
  until: string;
  /** What each account gained or lost before `until`; its starting balance is not in it. */
  moved: Record<string, number>;
  /** The last shift counted before `until`: the next opening is compared with it. */
  carry?: CashShift;
  /** The month's own lines, newest first. */
  entries?: FinanceEntry[];
}

export const INKASSASIYA = 'İnkassasiya';
export const CAT_CASH_IN = 'Növbə · nağd';
export const CAT_CARD_IN = 'Növbə · kart';
export const CAT_MOVE_IN = 'Kassa mədaxili';
export const CAT_MOVE_OUT = 'Kassa məxarici';
// The reason the till and the database write on the cash-in a rider's payback makes.
export const CAT_COURIER = 'Kuryer ödənişi';
export const CAT_CASH_DIFF = 'Kassa fərqi';
export const CAT_CARD_DIFF = 'Terminal fərqi';
export const CAT_GAP_OUT = 'Naməlum çıxarış';
export const CAT_GAP_IN = 'Naməlum mədaxil';
export const EXPENSE_CATEGORIES = ['İcarə', 'Maaş', 'Kommunal', 'Təchizat', 'Təmir', 'Vergi', 'Digər xərc'];
export const INCOME_CATEGORIES = ['Digər gəlir', 'İnvestisiya'];

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** What was typed as an amount: a positive number to the qəpik, or null. */
export function parseAmount(text: string): number | null {
  const n = round2(Number(text.trim().replace(',', '.')));
  return text.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null;
}

/** The account that takes this kind of shift money at that moment. */
export function sourceAccount(sources: FinanceSource[], kind: SourceKind, at: string): string | undefined {
  let best: FinanceSource | undefined;
  for (const s of sources) {
    if (s.kind !== kind || s.fromAt > at) continue;
    if (!best || s.fromAt >= best.fromAt) best = s;
  }
  return best?.accountId;
}

/**
 * The money one closed shift brought. The cash lines add up to what the drawer
 * really gained (counted − opening), so the account follows the drawer:
 * what came in over the counter, each cash in or out, and any shortfall.
 * Card: what the app recorded, corrected to the terminal's own total when the
 * cashier entered it.
 *
 * "Came in" is money, not sales: it holds what riders paid back for older
 * shifts too, which is why it is not called satış.
 */
export function shiftEntries(shift: CashShift, sources: FinanceSource[]): FinanceEntry[] {
  if (!shift.closedAt || shift.expectedCash === undefined) return [];
  const at = shift.closedAt;
  const out: FinanceEntry[] = [];
  const line = (key: string, accountId: string, signed: number, title: string, category: string, by?: string) => {
    const amount = round2(Math.abs(signed));
    if (amount === 0) return;
    out.push({ id: `shift:${shift.id}:${key}`, at, kind: signed > 0 ? 'income' : 'expense', accountId, amount, title, category,
      by: by ?? shift.closedBy, shiftId: shift.id });
  };

  const cash = sourceAccount(sources, 'cash', at);
  if (cash) {
    const moved = shift.movements.reduce((t, m) => t + m.amount, 0);
    line('cash', cash, shift.expectedCash - shift.openingCash - moved, 'Növbə bağlandı · nağd daxilolma', CAT_CASH_IN);
    shift.movements.forEach((m, i) =>
      line(`mov:${m.id ?? i}`, cash, m.amount, m.reason || (m.amount > 0 ? CAT_MOVE_IN : CAT_MOVE_OUT),
        // A rider's payback is delivery money, not just "cash put in the drawer".
        m.amount > 0 ? (m.reason === CAT_COURIER ? CAT_COURIER : CAT_MOVE_IN) : CAT_MOVE_OUT, m.by));
    if (shift.countedCash !== undefined) {
      line('cashdiff', cash, shift.countedCash - shift.expectedCash, 'Kassa fərqi', CAT_CASH_DIFF);
    }
  }

  const card = sourceAccount(sources, 'card', at);
  if (card && shift.cardSales !== undefined) {
    line('card', card, shift.cardSales, 'Növbə bağlandı · kart məbləği', CAT_CARD_IN);
    if (shift.countedCard !== undefined) {
      line('carddiff', card, shift.countedCard - shift.cardSales, 'Terminal fərqi', CAT_CARD_DIFF);
    }
  }
  return out;
}

/**
 * Cash that moved between two shifts with nothing written.
 *
 * Test Restoran, 2026-10-13: every shift opened with 0 ₼ though the one before
 * had counted money (133, 84.50…). The account only added what shifts brought,
 * so it went on showing cash that had left the drawer. The next opening is the
 * only sign: what it is short of the last count went out, what it is over came
 * in. Each gap is a line on the cash account until the owner says where the
 * money went — a transaction naming the shift (`gapShiftId`) answers that much
 * of it, and only what is left stays as "naməlum".
 */
export function gapEntries(shifts: CashShift[], sources: FinanceSource[], transactions: FinanceTransaction[]): FinanceEntry[] {
  const sorted = [...shifts].sort((a, b) => a.openedAt.localeCompare(b.openedAt));
  const out: FinanceEntry[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1], next = sorted[i];
    if (!prev.closedAt || prev.countedCash === undefined) continue;
    // Only when the count before went to the same account this opening belongs to.
    const account = sourceAccount(sources, 'cash', next.openedAt);
    if (!account || sourceAccount(sources, 'cash', prev.closedAt) !== account) continue;

    const answered = transactions.reduce((t, x) => {
      if (x.gapShiftId !== next.id || x.deletedAt) return t;
      const q = Math.round(x.amount * 100);
      if (x.kind === 'transfer') return t + (x.toAccountId === account ? q : x.accountId === account ? -q : 0);
      return x.accountId === account ? t + (x.kind === 'income' ? q : -q) : t;
    }, 0);
    const rest = Math.round(next.openingCash * 100) - Math.round(prev.countedCash * 100) - answered;
    if (rest === 0) continue;
    out.push({
      id: `gap:${next.id}`, at: next.openedAt, kind: rest > 0 ? 'income' : 'expense', accountId: account, amount: Math.abs(rest) / 100,
      title: rest < 0 ? 'Kassadan götürülüb, yazılmayıb' : 'Kassaya qoyulub, yazılmayıb',
      category: rest < 0 ? CAT_GAP_OUT : CAT_GAP_IN, by: next.openedBy,
      gapShiftId: next.id, gap: { counted: prev.countedCash, opened: next.openingCash },
    });
  }
  return out;
}

/** The gaps the owner has not explained yet, newest first. */
export function openGaps(entries: FinanceEntry[]): FinanceEntry[] {
  return entries.filter(e => e.gapShiftId !== undefined);
}

export function transactionEntry(t: FinanceTransaction): FinanceEntry {
  const category = t.category || (t.kind === 'transfer' ? 'Köçürmə' : t.kind === 'income' ? 'Digər gəlir' : 'Digər xərc');
  return { id: t.id, at: t.happenedAt, kind: t.kind, accountId: t.accountId, toAccountId: t.toAccountId, amount: t.amount,
    title: t.note || category, category, by: t.createdBy, deletedAt: t.deletedAt, deletedBy: t.deletedBy };
}

// Moments are compared as moments: the database and the browser write the same
// instant differently ('+00:00', '.000Z'), and as text those do not sort.
const ms = (at: string) => Date.parse(at);

/**
 * Every line still open, newest first. With a closed month behind, only what
 * happened from its end on: the rest is in the closing and must not be counted
 * a second time.
 */
export function financeEntries(transactions: FinanceTransaction[], shifts: CashShift[], sources: FinanceSource[], closing?: FinanceClosing): FinanceEntry[] {
  const all = [...transactions.filter(t => !t.deletedAt).map(transactionEntry), ...shifts.flatMap(s => shiftEntries(s, sources)),
    ...gapEntries(closing?.carry ? [closing.carry, ...shifts] : shifts, sources, transactions)];
  const from = closing ? ms(closing.until) : undefined;
  return (from === undefined ? all : all.filter(e => ms(e.at) >= from)).sort((a, b) => ms(b.at) - ms(a.at));
}

// What the lines add to each account, in qəpik.
function movedBy(entries: FinanceEntry[], q: Record<string, number>, known: boolean): Record<string, number> {
  const add = (id: string | undefined, n: number) => { if (id !== undefined && (!known || id in q)) q[id] = (q[id] ?? 0) + n; };
  for (const e of entries) {
    const n = Math.round(e.amount * 100);
    if (e.kind === 'income') add(e.accountId, n);
    else add(e.accountId, -n);
    if (e.kind === 'transfer') add(e.toAccountId, n);
  }
  return q;
}

/** Each account's balance now: its starting balance, what the closed months left, and every open line that touches it. */
export function accountBalances(accounts: FinanceAccount[], entries: FinanceEntry[], closing?: FinanceClosing): Record<string, number> {
  const q: Record<string, number> = {};
  for (const a of accounts) q[a.id] = Math.round(a.openingBalance * 100) + Math.round((closing?.moved[a.id] ?? 0) * 100);
  movedBy(entries, q, true);
  return Object.fromEntries(Object.entries(q).map(([id, n]) => [id, n / 100]));
}

export function entriesBetween(entries: FinanceEntry[], from: string, to: string): FinanceEntry[] {
  return entries.filter(e => ms(e.at) >= ms(from) && ms(e.at) < ms(to));
}

export interface FinanceReport {
  income: { category: string; amount: number }[];
  expense: { category: string; amount: number }[];
  totalIncome: number;
  totalExpense: number;
}

/**
 * Money in and money out, by category. A transfer only moves money between the
 * owner's own accounts, so it is in neither. There is no profit figure: the
 * accounts see money move, not what the food cost, and income here holds
 * things that are not earnings (a repaid debt, change put in the drawer).
 */
export function financeReport(entries: FinanceEntry[]): FinanceReport {
  const sums = { income: new Map<string, number>(), expense: new Map<string, number>() };
  for (const e of entries) {
    if (e.kind === 'transfer') continue;
    sums[e.kind].set(e.category, (sums[e.kind].get(e.category) ?? 0) + Math.round(e.amount * 100));
  }
  const rows = (m: Map<string, number>) =>
    [...m].map(([category, q]) => ({ category, amount: q / 100 })).sort((a, b) => b.amount - a.amount);
  const total = (m: Map<string, number>) => [...m.values()].reduce((t, q) => t + q, 0);
  return { income: rows(sums.income), expense: rows(sums.expense),
    totalIncome: total(sums.income) / 100, totalExpense: total(sums.expense) / 100 };
}

/** A month ('YYYY-MM') as the company's business days: from its first day's start to the next month's. */
export function monthRange(month: string, s: CompanySettings): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { from: businessDayStartUtc(`${month}-01`, s).toISOString(), to: businessDayStartUtc(`${next}-01`, s).toISOString() };
}

/** Why an account cannot be switched off, or null. */
export function accountOffBlock(accountId: string, sources: FinanceSource[], now: string): string | null {
  if (sourceAccount(sources, 'cash', now) === accountId) return 'Növbənin nağd pulu bu hesaba düşür. Əvvəlcə başqa hesab seçin.';
  if (sourceAccount(sources, 'card', now) === accountId) return 'Növbənin kart pulu bu hesaba düşür. Əvvəlcə başqa hesab seçin.';
  return null;
}

/** All the money there is: every account's balance, switched-off ones too. */
export function totalBalance(balances: Record<string, number>): number {
  return Object.values(balances).reduce((t, n) => t + Math.round(n * 100), 0) / 100;
}

/** The lines that touch one account (a transfer touches two); all of them without one. */
export function entriesOfAccount(entries: FinanceEntry[], accountId?: string): FinanceEntry[] {
  return accountId ? entries.filter(e => e.accountId === accountId || e.toAccountId === accountId) : entries;
}

/** Lines under the calendar day they happened on, in the company's timezone; the order is kept. */
export function entriesByDay(entries: FinanceEntry[], tz: string): { day: string; entries: FinanceEntry[] }[] {
  const out: { day: string; entries: FinanceEntry[] }[] = [];
  for (const e of entries) {
    const day = tzDateStr(new Date(e.at), tz);
    const last = out[out.length - 1];
    if (last?.day === day) last.entries.push(e); else out.push({ day, entries: [e] });
  }
  return out;
}

const AZ_MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'];

/** 'YYYY-MM' moved by n months. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

/** '2026-10' → 'Oktyabr 2026'. */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const name = AZ_MONTHS[m - 1] ?? '';
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`;
}

/** '2026-10-12' → '12 oktyabr'. */
export function dayLabel(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  return `${d} ${AZ_MONTHS[m - 1] ?? ''}`;
}

/** What these lines add up to: money in minus money out (a transfer is neither). */
export function netOf(entries: FinanceEntry[]): number {
  return entries.reduce((t, e) => t + (e.kind === 'income' ? 1 : e.kind === 'expense' ? -1 : 0) * Math.round(e.amount * 100), 0) / 100;
}

/** The deleted lines, last deleted first. They count in no balance and no report. */
export function deletedEntries(transactions: FinanceTransaction[]): FinanceEntry[] {
  return transactions.filter(t => t.deletedAt).map(transactionEntry)
    .sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''));
}

/** One change to an account, in words: "Başlanğıc qalıq: 500.00 ₼ → 5000.00 ₼". */
export function accountEditText(e: AccountEdit): string {
  const show = (v: string | number | boolean) =>
    e.field === 'opening_balance' ? `${Number(v).toFixed(2)} ₼`
    : e.field === 'kind' ? ACCOUNT_KIND_LABEL[v as AccountKind] ?? String(v)
    : e.field === 'active' ? (v ? 'aktiv' : 'söndürülüb')
    : String(v);
  const label = { opening_balance: 'Başlanğıc qalıq', name: 'Ad', kind: 'Növ', active: 'Vəziyyət' }[e.field];
  return `${label}: ${show(e.from)} → ${show(e.to)}`;
}

/** The accounts that exist: a deleted one is in no list, no picker and no total. */
export function liveAccounts(accounts: FinanceAccount[]): FinanceAccount[] {
  return accounts.filter(a => !a.deletedAt);
}

/** The deleted accounts, last deleted first. */
export function deletedAccounts(accounts: FinanceAccount[]): FinanceAccount[] {
  return accounts.filter(a => a.deletedAt).sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''));
}

/**
 * What to type as the starting balance of the account that takes shift cash.
 *
 * The account adds what each shift's drawer gained (counted − opening), so it
 * only follows the drawer when it starts from what the first shift opened
 * with. With a shift open that is its opening cash, not the cash in the drawer
 * now: what the shift has taken since is added when it closes, and typing it
 * here would count it twice.
 */
export function cashStartHint(shifts: CashShift[]): string {
  const open = shifts.find(s => !s.closedAt);
  return open
    ? `Növbənin nağd pulu bu hesaba düşəcəksə, başlanğıc qalıq açıq növbənin açılış məbləği olmalıdır: ${open.openingCash.toFixed(2)} ₼. İndi kassada olan pulu yazmayın — növbənin yığdığı pul bağlananda özü əlavə olunur.`
    : 'Növbənin nağd pulu bu hesaba düşəcəksə, başlanğıc qalığa kassada indi olan nağd pulu sayıb yazın. Səhv rəqəm yazılsa, hesab həmişə o qədər fərqli göstərəcək.';
}

/** The month ('YYYY-MM') a moment belongs to, by the company's business days. */
export function monthOf(at: string, s: CompanySettings): string {
  const month = tzDateStr(new Date(at), s.timezone).slice(0, 7);
  const { from, to } = monthRange(month, s);
  return ms(at) < ms(from) ? addMonths(month, -1) : ms(at) >= ms(to) ? addMonths(month, 1) : month;
}

/** This month and the one before stay open, so the owner has time to explain what is unwritten. */
export const OPEN_MONTHS = 2;

/**
 * The months that are due to be closed, oldest first, each ready to save.
 *
 * `entries` and `shifts` are everything still open (after `last`, the newest
 * closing). A month takes the lines dated in it; a gap nobody explained goes in
 * as "naməlum" and stays so. Each closing carries the totals of the ones before
 * it, so the newest one alone is enough to count from.
 */
export function dueClosings(entries: FinanceEntry[], shifts: CashShift[], last: FinanceClosing | undefined, currentMonth: string, s: CompanySettings): FinanceClosing[] {
  const oldest = entries[entries.length - 1];
  let month = last ? addMonths(last.month, 1) : oldest ? monthOf(oldest.at, s) : undefined;
  if (!month) return [];
  const final = addMonths(currentMonth, -OPEN_MONTHS);
  const out: FinanceClosing[] = [];
  let from = last ? ms(last.until) : -Infinity;
  let carry = last?.carry;
  const q: Record<string, number> = {};
  for (const [id, n] of Object.entries(last?.moved ?? {})) q[id] = Math.round(n * 100);
  for (; month <= final; month = addMonths(month, 1)) {
    const until = monthRange(month, s).to;
    const lines = entries.filter(e => ms(e.at) >= from && ms(e.at) < ms(until));
    movedBy(lines, q, false);
    for (const x of shifts) {
      if (!x.closedAt || ms(x.closedAt) >= ms(until) || (carry && ms(x.openedAt) <= ms(carry.openedAt))) continue;
      // Only what the next opening is compared with.
      carry = { id: x.id, openedAt: x.openedAt, openedBy: x.openedBy, openingCash: x.openingCash,
        closedAt: x.closedAt, closedBy: x.closedBy, countedCash: x.countedCash, movements: [], edits: [] };
    }
    out.push({ month, until, moved: Object.fromEntries(Object.entries(q).map(([id, n]) => [id, n / 100])), carry, entries: lines });
    from = ms(until);
  }
  return out;
}

/** Whether this moment is inside a closed month: nothing can be written or deleted there. */
export function inClosedMonth(at: string, closing?: FinanceClosing): boolean {
  return closing !== undefined && ms(at) < ms(closing.until);
}

/** Whether the month is closed: its lines are then read from the closing, not counted. */
export function isClosedMonth(month: string, closing?: FinanceClosing): boolean {
  return closing !== undefined && month <= closing.month;
}

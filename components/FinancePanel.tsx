'use client';

// Maliyyə — the owner's money accounts.
//
// Accounts with their balances, the lines that moved them, and a month's income
// and expense. A closed shift brings its cash and card money by itself, and
// inkassasiya arrives as it is written in Kassa; the owner types the rest
// (expense, income, transfer). Nothing is counted here: every number comes
// from lib/finance.

import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Minus, ArrowLeftRight, ArrowDownLeft, ArrowUpRight, CreditCard, Landmark, Wallet, Pencil, Trash2, Settings, X,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import {
  fetchFinance, fetchFinanceClosing, saveFinanceClosings, ensureFinanceDefaults, createFinanceAccount, updateFinanceAccount, deleteFinanceAccount,
  setFinanceSource, addFinanceTransaction, deleteFinanceTransaction, type FinanceData,
} from '@/lib/store';
import {
  ACCOUNT_KIND_LABEL, EXPENSE_CATEGORIES, INCOME_CATEGORIES,
  accountBalances, accountEditText, accountOffBlock, addMonths, cashStartHint, dayLabel, deletedAccounts, deletedEntries, dueClosings, entriesBetween, entriesByDay, entriesOfAccount, financeEntries, financeReport,
  inClosedMonth, isClosedMonth, liveAccounts, missingDefaults, monthLabel, monthRange, parseAmount, sourceAccount, totalBalance,
  type AccountKind, type EntryKind, type FinanceAccount, type FinanceClosing, type FinanceEntry, type SourceKind,
} from '@/lib/finance';
import { getSession } from '@/lib/auth';
import { DialogState } from '@/components/AppDialog';
import { inputCls, btnPrimary, btnGhost, Modal } from '@/components/panel-ui';
import { CompanySettings, businessToday, tzDateStr, tzTime } from '@/lib/business-day';

type FormKind = 'income' | 'expense' | 'transfer';
const FORM_TITLE: Record<FormKind, string> = { income: 'Gəlir', expense: 'Xərc', transfer: 'Köçürmə' };
// What each account can be set to take by itself.
const SOURCE_KINDS: SourceKind[] = ['cash', 'card', 'inkassasiya'];
const SOURCE_LABEL: Record<SourceKind, string> = { cash: 'Nağd pul', card: 'Kart pulu', inkassasiya: 'Kassadan inkassasiya' };
const SOURCE_TAG: Record<SourceKind, string> = { cash: 'Növbənin nağd pulu', card: 'Növbənin kart pulu', inkassasiya: 'Kassadan inkassasiya' };

const money = (n: number) => `${n.toFixed(2)} ₼`;
const card = 'bg-white rounded-xl border border-stone-100';
const btnColor = 'inline-flex items-center gap-1.5 px-3.5 py-2 text-sm rounded-lg text-white font-medium transition-colors';
const KIND_LOOK: Record<AccountKind, { icon: React.ElementType; badge: string }> = {
  cash: { icon: Wallet, badge: 'bg-green-100 text-green-700' },
  card: { icon: CreditCard, badge: 'bg-blue-100 text-blue-700' },
  bank: { icon: Landmark, badge: 'bg-amber-100 text-amber-700' },
};
const ENTRY_LOOK: Record<EntryKind, { icon: React.ElementType; badge: string; text: string; sign: string }> = {
  income: { icon: ArrowDownLeft, badge: 'bg-green-50 text-green-700', text: 'text-green-700', sign: '+' },
  expense: { icon: ArrowUpRight, badge: 'bg-red-50 text-red-600', text: 'text-red-600', sign: '−' },
  transfer: { icon: ArrowLeftRight, badge: 'bg-stone-100 text-stone-600', text: 'text-stone-700', sign: '' },
};

export default function FinancePanel({ setDialog, bizSettings }: {
  setDialog: (d: DialogState | null) => void;
  bizSettings: CompanySettings;
}) {
  const [data, setData] = useState<FinanceData | null>(null);
  const [failed, setFailed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [month, setMonth] = useState(() => businessToday(bizSettings).slice(0, 7));
  const [accountForm, setAccountForm] = useState<FinanceAccount | 'new' | null>(null);
  const [txForm, setTxForm] = useState<FormKind | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Tap an account to see only its lines.
  const [filter, setFilter] = useState<string | undefined>();
  const [trashOpen, setTrashOpen] = useState(false);
  // A closed month's lines, read when the owner turns to it. null: could not be read.
  const [past, setPast] = useState<{ month: string; entries: FinanceEntry[] | null } | null>(null);

  const me = getSession()?.name ?? 'Admin';
  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2600); }
  function fail(msg: string | null) { if (msg) setDialog({ title: 'Xəta', message: msg }); }

  // A failed read keeps what is on screen: an empty list here would read as
  // "no money" (LESSONS: failed is not empty).
  async function reload() {
    let next = await fetchFinance();
    // The accounts every restaurant starts with, made once by the database.
    let made: Awaited<ReturnType<typeof ensureFinanceDefaults>> = null;
    // Read before they were made: the open shift is in it even if the next read fails.
    const startShifts = next?.shifts ?? [];
    if (next && missingDefaults(next.accounts, next.sources)) {
      made = await ensureFinanceDefaults(me);
      if (made && made !== 'none') next = await fetchFinance();
    }
    if (next) {
      // Months that have ended are closed here, once: saved, then read back.
      // If the save fails the page still counts them itself, as before.
      const due = dueClosings(financeEntries(next.transactions, next.shifts, next.sources, next.closing),
        next.closing, businessToday(bizSettings).slice(0, 7), bizSettings);
      if (due.length > 0 && !(await saveFinanceClosings(due, me))) next = await fetchFinance();
    }
    if (next) setData(next);
    setFailed(!next);
    // Said once, and only now: the accounts exist even when the read after them failed.
    if (made === 'all') {
      setDialog({
        title: 'Hesablar yaradıldı',
        message: <>
          «Nağd», «Bank» və «İnkassasiya» hesabları yaradıldı. Növbə bağlananda nağd pul «Nağd»a, kart pulu «Bank»a düşür;
          kassada yazılan inkassasiya dərhal «İnkassasiya» hesabına düşür. Adları dəyişə, yeni hesab əlavə edə bilərsiniz.
          <span className="block mt-2 text-amber-700">«Nağd» hesabının başlanğıc qalığını yazın. {cashStartHint(startShifts)}</span>
        </>,
      });
    } else if (made === 'inkassasiya') {
      flash('«İnkassasiya» hesabı yaradıldı: kassada yazılan inkassasiya bura düşəcək');
    }
  }
  useEffect(() => { reload(); }, []);

  const closing = data?.closing;
  const closedMonth = isClosedMonth(month, closing);
  useEffect(() => {
    if (!closedMonth) return;
    let on = true;
    fetchFinanceClosing(month).then(list => { if (on) setPast({ month, entries: list }); });
    return () => { on = false; };
  }, [month, closedMonth]);

  const entries = useMemo(() => data ? financeEntries(data.transactions, data.shifts, data.sources, data.closing) : [], [data]);
  const balance = useMemo(() => data ? accountBalances(liveAccounts(data.accounts), entries, data.closing) : {}, [data, entries]);
  const total = useMemo(() => totalBalance(balance), [balance]);
  const deleted = useMemo(() => data ? deletedEntries(data.transactions) : [], [data]);
  const range = useMemo(() => monthRange(month, bizSettings), [month, bizSettings]);
  const pastEntries = past?.month === month ? past.entries : undefined;
  const shown = useMemo(() => closedMonth ? pastEntries ?? [] : entriesBetween(entries, range.from, range.to),
    [closedMonth, pastEntries, entries, range]);
  const report = useMemo(() => financeReport(shown), [shown]);

  if (!data) {
    return failed ? (
      <div className={`${card} p-8 text-center space-y-3`}>
        <p className="text-sm text-stone-600">Maliyyə oxunmadı. İnternet bağlantısını yoxlayın.</p>
        <button className={btnPrimary} onClick={reload}>Yenidən cəhd et</button>
      </div>
    ) : <div className="text-sm text-stone-400 py-10 text-center">Yüklənir…</div>;
  }

  const now = new Date().toISOString();
  const accounts = liveAccounts(data.accounts);
  const goneAccounts = deletedAccounts(data.accounts);
  const active = accounts.filter(a => a.active);
  const nameOf = (id?: string) => accounts.find(a => a.id === id)?.name ?? '—';
  const startHint = cashStartHint(data.shifts);
  const source: Record<SourceKind, string | undefined> = {
    cash: sourceAccount(data.sources, 'cash', now),
    card: sourceAccount(data.sources, 'card', now),
    inkassasiya: sourceAccount(data.sources, 'inkassasiya', now),
  };

  async function changeSource(kind: SourceKind, accountId: string) {
    const err = await setFinanceSource(kind, accountId || null, me);
    if (err) return fail(err);
    await reload();
    flash(!accountId ? 'Söndürüldü'
      : kind === 'inkassasiya' ? `Bundan sonra kassada yazılan inkassasiya «${nameOf(accountId)}» hesabına düşəcək`
      : `Bundan sonra bağlanan növbələrin ${kind === 'cash' ? 'nağd' : 'kart'} pulu «${nameOf(accountId)}» hesabına düşəcək`);
  }

  function askDelete(e: FinanceEntry) {
    setDialog({
      title: 'Əməliyyatı sil',
      message: `${e.title.length > 60 ? `${e.title.slice(0, 60)}…` : e.title} — ${money(e.amount)}. Silinsin? Yazı «Silinənlər» siyahısında qalacaq.`,
      onConfirm: async () => {
        const err = await deleteFinanceTransaction(e.id, me);
        if (err) return fail(err);
        await reload();
        flash('Silindi');
      },
    });
  }

  const filtered = entriesOfAccount(shown, accounts.some(a => a.id === filter) ? filter : undefined);
  const days = entriesByDay(filtered, bizSettings.timezone);
  const top = Math.max(1, ...report.income.map(r => r.amount), ...report.expense.map(r => r.amount));

  return (
    <div className="space-y-4">
      {failed && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl px-4 py-2.5 flex items-center justify-between gap-3">
          <span>Yenilənmədi — ekrandakı rəqəmlər köhnə ola bilər.</span>
          <button className="font-semibold underline shrink-0" onClick={reload}>Yenilə</button>
        </div>
      )}

      {accounts.length === 0 ? (
        <div className={`${card} p-8 text-center space-y-3`}>
          <p className="text-sm font-semibold text-stone-800">Hələ hesab yoxdur</p>
          <p className="text-sm text-stone-500">Pulun saxlandığı yerləri yaradın: Kassa, Seyf, bank kartı və ya istədiyiniz başqa hesab.</p>
          <button className={btnPrimary} onClick={() => setAccountForm('new')}><Plus className="w-4 h-4" />Yeni hesab</button>
        </div>
      ) : (
        <>
          {/* All the money, then where it is */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">Cəmi pul</p>
              <p className={`text-3xl font-bold tabular-nums break-words ${total < 0 ? 'text-red-600' : 'text-stone-900'}`}>{money(total)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className={btnGhost} onClick={() => setSettingsOpen(true)}><Settings className="w-4 h-4" />Ayarlar</button>
              <button className={btnGhost} onClick={() => setAccountForm('new')}><Plus className="w-4 h-4" />Yeni hesab</button>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {accounts.map(a => {
              const look = KIND_LOOK[a.kind];
              const on = filter === a.id;
              return (
                <div key={a.id} role="button" tabIndex={0} aria-pressed={on}
                  onClick={() => setFilter(on ? undefined : a.id)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFilter(on ? undefined : a.id); } }}
                  className={`${card} p-4 min-w-0 cursor-pointer transition-shadow hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 ${
                    on ? 'ring-2 ring-primary-700 border-transparent' : ''} ${a.active ? '' : 'opacity-60'}`}>
                  <div className="flex items-center gap-3">
                    <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${look.badge}`}><look.icon className="w-5 h-5" strokeWidth={2.25} /></span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-stone-800 break-words leading-tight">{a.name}</p>
                      <p className="text-[11px] text-stone-400">{ACCOUNT_KIND_LABEL[a.kind]}{a.active ? '' : ' · söndürülüb'}</p>
                    </div>
                    <button className="p-1.5 rounded-lg text-stone-400 hover:bg-stone-50 hover:text-stone-700 shrink-0 self-start"
                      onClick={e => { e.stopPropagation(); setAccountForm(a); }} aria-label="Hesabı düzəlt">
                      <Pencil className="w-4 h-4" />
                    </button>
                  </div>
                  <p className={`text-xl font-bold tabular-nums mt-3 break-words ${balance[a.id] < 0 ? 'text-red-600' : 'text-stone-900'}`}>
                    {money(balance[a.id] ?? 0)}
                  </p>
                  {SOURCE_KINDS.some(k => source[k] === a.id) && (
                    <p className="text-[11px] font-medium text-primary-700 mt-0.5">
                      {SOURCE_KINDS.filter(k => source[k] === a.id).map(k => SOURCE_TAG[k]).join(' və ')} bura düşür
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-2">
            <button className={`${btnColor} bg-green-600 hover:bg-green-700`} onClick={() => setTxForm('income')}><Plus className="w-4 h-4" />Gəlir</button>
            <button className={`${btnColor} bg-red-600 hover:bg-red-700`} onClick={() => setTxForm('expense')}><Minus className="w-4 h-4" />Xərc</button>
            <button className={`${btnGhost} bg-white disabled:opacity-50`} onClick={() => setTxForm('transfer')} disabled={active.length < 2}><ArrowLeftRight className="w-4 h-4" />Köçürmə</button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-4 items-start">
            {/* Every line of the month, by day */}
            <div className={`${card} min-w-0`}>
              <div className="px-4 py-3 border-b border-stone-100 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-stone-800">Əməliyyatlar</p>
                {deleted.length + goneAccounts.length > 0 && (
                  <button className="inline-flex items-center gap-1 text-xs font-medium text-stone-500 hover:text-stone-800 ml-auto" onClick={() => setTrashOpen(true)}>
                    <Trash2 className="w-3.5 h-3.5" />Silinənlər ({deleted.length + goneAccounts.length})
                  </button>
                )}
                {filter && accounts.some(a => a.id === filter) && (
                  <button className="inline-flex items-center gap-1 text-xs font-medium bg-stone-100 text-stone-700 rounded-full pl-2.5 pr-1.5 py-1 max-w-full"
                    onClick={() => setFilter(undefined)}>
                    <span className="truncate">Yalnız: {nameOf(filter)}</span><X className="w-3.5 h-3.5 shrink-0" />
                  </button>
                )}
              </div>
              {closedMonth && (
                <p className="px-4 py-2 text-xs text-stone-500 bg-stone-50 border-b border-stone-100">
                  {pastEntries === null ? 'Bu ay oxunmadı. İnternet bağlantısını yoxlayıb yenidən açın.'
                    : pastEntries === undefined ? 'Yüklənir…'
                    : 'Bu ay bağlanıb: rəqəmləri artıq dəyişmir, yazı əlavə etmək və silmək olmur.'}
                </p>
              )}
              {closedMonth && !pastEntries ? null : days.length === 0 ? (
                <p className="text-sm text-stone-400 text-center py-8">{filter ? 'Bu hesabda bu ay əməliyyat yoxdur' : 'Bu ay əməliyyat yoxdur'}</p>
              ) : days.map(d => (
                <div key={d.day}>
                  <p className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-400 bg-stone-50 border-b border-stone-100">{dayLabel(d.day)}</p>
                  {d.entries.map(e => {
                    const look = ENTRY_LOOK[e.kind];
                    return (
                      <div key={e.id} className="px-4 py-2.5 border-b border-stone-100 last:border-b-0 flex items-center gap-3">
                        <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${look.badge}`}><look.icon className="w-4 h-4" /></span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-stone-800 break-words">{e.title}</p>
                          <p className="text-xs text-stone-500 break-words">
                            {tzTime(e.at, bizSettings.timezone)}
                            {' · '}{e.kind === 'transfer' ? `${nameOf(e.accountId)} → ${nameOf(e.toAccountId)}` : nameOf(e.accountId)}
                            {e.title !== e.category && <>{' · '}{e.category}</>}
                            {e.by && <>{' · '}{e.by}</>}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={`text-sm font-semibold tabular-nums ${look.text}`}>{look.sign}{money(e.amount)}</p>
                          {e.closed ? null : e.shiftId
                            ? <span className="text-[11px] font-medium text-primary-700">Növbədən</span>
                            : <button className="text-stone-300 hover:text-red-500" onClick={() => askDelete(e)} aria-label="Sil"><Trash2 className="w-3.5 h-3.5" /></button>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* The month's income and expense */}
            <div className={`${card} p-4 space-y-4 min-w-0`}>
              <div className="flex items-center justify-between gap-2">
                <button className="p-1.5 rounded-lg text-stone-500 hover:bg-stone-50" onClick={() => setMonth(addMonths(month, -1))} aria-label="Əvvəlki ay"><ChevronLeft className="w-4 h-4" /></button>
                <p className="text-sm font-semibold text-stone-800">{monthLabel(month)}</p>
                <button className="p-1.5 rounded-lg text-stone-500 hover:bg-stone-50" onClick={() => setMonth(addMonths(month, 1))} aria-label="Növbəti ay"><ChevronRight className="w-4 h-4" /></button>
              </div>
              {([['Gəlir', report.totalIncome, report.income, 'bg-green-500', 'text-green-700'],
                ['Xərc', report.totalExpense, report.expense, 'bg-red-400', 'text-red-600']] as const).map(([label, sum, rows, bar, text]) => (
                <div key={label} className="min-w-0 space-y-2">
                  <div className="flex justify-between gap-3 text-sm font-semibold">
                    <span className="text-stone-800">{label}</span>
                    <span className={`tabular-nums ${text}`}>{money(sum)}</span>
                  </div>
                  {rows.length === 0 ? <p className="text-sm text-stone-400">—</p> : rows.map(r => (
                    <div key={r.category} className="min-w-0">
                      <div className="flex justify-between gap-3 text-xs">
                        <span className="text-stone-600 min-w-0 break-words">{r.category}</span>
                        <span className="tabular-nums font-medium text-stone-800 shrink-0">{money(r.amount)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-stone-100 mt-1">
                        <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.max(2, (r.amount / top) * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              ))}
              <p className="text-xs text-stone-400">Köçürmə nə gəlirdir, nə xərc: pul yalnız hesabdan hesaba keçir. Kassadakı mədaxil və məxaric burada göstərilmir, onlar Kassada qalır.</p>
            </div>
          </div>
        </>
      )}

      {settingsOpen && (
        <Modal title="Növbənin pulu" onClose={() => setSettingsOpen(false)}>
          <div className="space-y-3">
            <p className="text-xs text-stone-500">
              Növbə bağlananda nağd və kart pulu seçdiyiniz hesaba özü düşür; açıq növbənin pulu bağlanana qədər görünmür.
              İnkassasiya kassada yazılan kimi düşür. Seçim yalnız bundan sonrakılara aiddir.
            </p>
            {SOURCE_KINDS.map(kind => (
              <Field key={kind} label={SOURCE_LABEL[kind]}>
                <select className={inputCls} value={source[kind] ?? ''} onChange={e => changeSource(kind, e.target.value)}>
                  <option value="">— heç bir hesaba —</option>
                  {accounts.filter(a => a.active || a.id === source[kind]).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                {kind === 'cash' && <p className="text-xs text-amber-700 mt-1.5">{startHint}</p>}
                {kind === 'inkassasiya' && (
                  <p className="text-xs text-stone-500 mt-1.5">
                    Kassada «İnkassasiya» yazılanda pul dərhal bu hesaba düşür. Hesab seçilməsə, heç bir hesaba yazılmır.
                  </p>
                )}
              </Field>
            ))}
            <button className={btnGhost} onClick={() => setSettingsOpen(false)}>Bağla</button>
          </div>
        </Modal>
      )}

      {accountForm && (
        <AccountForm
          account={accountForm === 'new' ? null : accountForm}
          offBlock={accountForm === 'new' ? null : accountOffBlock(accountForm.id, data.sources, now)}
          me={me} tz={bizSettings.timezone} startHint={startHint}
          onClose={() => setAccountForm(null)}
          onDone={async msg => { setAccountForm(null); await reload(); flash(msg); }}
        />
      )}
      {trashOpen && (
        <Modal title="Silinənlər" wide onClose={() => setTrashOpen(false)}>
          <div className="space-y-3">
            <p className="text-xs text-stone-500">Silinən yazılar heç bir hesaba və hesabata daxil deyil. Burada kimin, nə vaxt sildiyi qalır.</p>
            <div className="divide-y divide-stone-100">
              {goneAccounts.map(a => (
                <div key={a.id} className="py-2.5 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-stone-800 break-words">Hesab: {a.name}</p>
                    <p className="text-xs text-stone-500">{ACCOUNT_KIND_LABEL[a.kind]} · başlanğıc qalıq</p>
                    {a.deletedAt && (
                      <p className="text-xs font-medium text-red-600 mt-0.5 break-words">
                        Sildi: {a.deletedBy ?? '—'} · {dayLabel(tzDateStr(new Date(a.deletedAt), bizSettings.timezone))} {tzTime(a.deletedAt, bizSettings.timezone)}
                      </p>
                    )}
                  </div>
                  <p className="text-sm font-semibold tabular-nums text-stone-400 line-through shrink-0">{money(a.openingBalance)}</p>
                </div>
              ))}
              {deleted.map(e => (
                <div key={e.id} className="py-2.5 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-stone-800 break-words">{e.title}</p>
                    <p className="text-xs text-stone-500 break-words">
                      {dayLabel(tzDateStr(new Date(e.at), bizSettings.timezone))} {tzTime(e.at, bizSettings.timezone)}
                      {' · '}{e.kind === 'transfer' ? `${nameOf(e.accountId)} → ${nameOf(e.toAccountId)}` : nameOf(e.accountId)}
                      {e.title !== e.category && <>{' · '}{e.category}</>}
                    </p>
                    {e.deletedAt && (
                      <p className="text-xs font-medium text-red-600 mt-0.5 break-words">
                        Sildi: {e.deletedBy ?? '—'} · {dayLabel(tzDateStr(new Date(e.deletedAt), bizSettings.timezone))} {tzTime(e.deletedAt, bizSettings.timezone)}
                      </p>
                    )}
                  </div>
                  <p className="text-sm font-semibold tabular-nums text-stone-400 line-through shrink-0">{ENTRY_LOOK[e.kind].sign}{money(e.amount)}</p>
                </div>
              ))}
            </div>
            <button className={btnGhost} onClick={() => setTrashOpen(false)}>Bağla</button>
          </div>
        </Modal>
      )}
      {txForm && (
        <TransactionForm
          kind={txForm} accounts={active} balance={balance} me={me} closing={closing}
          usedCategories={data.transactions.filter(t => t.kind === txForm && t.category).map(t => t.category!)}
          onClose={() => setTxForm(null)}
          onDone={async () => { setTxForm(null); await reload(); flash('Yazıldı'); }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-stone-800 text-white text-sm px-4 py-2 rounded-lg shadow-lg z-[110] max-w-[90vw] text-center">
          {toast}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-xs font-medium text-stone-500">{label}</span><div className="mt-1">{children}</div></label>;
}

function AccountForm({ account, offBlock, me, tz, startHint, onClose, onDone }: {
  account: FinanceAccount | null; offBlock: string | null; me: string; tz: string; startHint: string;
  onClose: () => void; onDone: (msg: string) => void;
}) {
  const [name, setName] = useState(account?.name ?? '');
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? 'cash');
  const [opening, setOpening] = useState(account ? String(account.openingBalance) : '');
  const [active, setActive] = useState(account?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Delete asks first: one click must not take an account, and its money, off the screen.
  const [asking, setAsking] = useState(false);

  async function run(work: () => Promise<string | null>, msg: string) {
    setBusy(true); setError(null);
    const err = await work();
    setBusy(false);
    if (err) setError(err); else onDone(msg);
  }

  function save() {
    if (!name.trim()) return setError('Hesabın adını yazın.');
    const open = opening.trim() === '' ? 0 : Number(opening.trim().replace(',', '.'));
    if (!Number.isFinite(open)) return setError('Başlanğıc qalığı düzgün yazın.');
    if (account && !active && offBlock) return setError(offBlock);
    const openingBalance = Math.round(open * 100) / 100;
    run(() => account
      ? updateFinanceAccount(account.id, { name, kind, openingBalance, active })
      : createFinanceAccount(name, kind, openingBalance, me), 'Yadda saxlanıldı');
  }

  return (
    <Modal title={account ? 'Hesabı düzəlt' : 'Yeni hesab'} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Ad"><input className={inputCls} value={name} maxLength={60} autoFocus onChange={e => setName(e.target.value)} placeholder="məs. Kassa, Seyf, Kapital Bank" /></Field>
        <Field label="Növ">
          <select className={inputCls} value={kind} onChange={e => setKind(e.target.value as AccountKind)}>
            {(Object.keys(ACCOUNT_KIND_LABEL) as AccountKind[]).map(k => <option key={k} value={k}>{ACCOUNT_KIND_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label="Başlanğıc qalıq, ₼"><input className={inputCls} inputMode="decimal" value={opening} onChange={e => setOpening(e.target.value)} placeholder="0.00" /></Field>
        {!account && kind === 'cash' && <p className="text-xs text-amber-700">{startHint}</p>}
        {account && (
          <label className="flex items-center gap-2 text-sm text-stone-700">
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
            Aktivdir (söndürülən hesab seçimlərdə görünmür, tarixçədə qalır)
          </label>
        )}
        {account && account.edits.length > 0 && (
          <div className="rounded-lg bg-stone-50 px-3 py-2.5 space-y-1.5 max-h-40 overflow-y-auto">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">Dəyişikliklər</p>
            {[...account.edits].reverse().map((e, i) => (
              <p key={i} className="text-xs text-stone-600 break-words">
                <span className="font-medium text-stone-800">{accountEditText(e)}</span>
                {' · '}{e.by} · {dayLabel(tzDateStr(new Date(e.at), tz))} {tzTime(e.at, tz)}
              </p>
            ))}
          </div>
        )}
        {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
        {account && asking ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 space-y-2">
            <p className="text-sm text-red-800 break-words">
              «{account.name}» hesabı silinsin? Başlanğıc qalığı ({money(account.openingBalance)}) «Cəmi pul»dan çıxacaq. Hesab «Silinənlər» siyahısında qalacaq.
            </p>
            <div className="flex flex-wrap gap-2">
              <button className={`${btnColor} bg-red-600 hover:bg-red-700 disabled:opacity-50`} disabled={busy}
                onClick={() => run(() => deleteFinanceAccount(account.id, me), 'Hesab silindi')}>Bəli, sil</button>
              <button className={btnGhost} disabled={busy} onClick={() => setAsking(false)}>Yox</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 pt-1">
            <button className={btnPrimary} disabled={busy} onClick={save}>Yadda saxla</button>
            <button className={btnGhost} onClick={onClose}>Bağla</button>
            {account && (
              <button className={`${btnGhost} ml-auto !text-red-600`} disabled={busy} onClick={() => { setError(null); setAsking(true); }}>
                <Trash2 className="w-4 h-4" />Sil
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// datetime-local wants the browser's own wall time, without a zone.
function localInputNow(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function TransactionForm({ kind, accounts, balance, usedCategories, me, closing, onClose, onDone }: {
  kind: FormKind; accounts: FinanceAccount[]; balance: Record<string, number>; closing?: FinanceClosing;
  usedCategories: string[]; me: string; onClose: () => void; onDone: () => void;
}) {
  const two = kind === 'transfer';
  const firstFrom = accounts[0]?.id ?? '';
  // One id for the life of the form: pressing save again after a lost reply
  // writes the same row, not a second one.
  const [id] = useState(() => crypto.randomUUID());
  const [from, setFrom] = useState(firstFrom);
  const [to, setTo] = useState(accounts.find(a => a.id !== firstFrom)?.id ?? '');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [note, setNote] = useState('');
  const [at, setAt] = useState(localInputNow);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categories = [...new Set([...(kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES), ...usedCategories])];
  const n = parseAmount(amount);
  const short = two && n !== null && n > (balance[from] ?? 0);

  async function save() {
    if (n === null) return setError('Məbləği yazın.');
    if (!from) return setError('Hesab seçin.');
    if (two && (!to || to === from)) return setError('İki fərqli hesab seçin.');
    const when = new Date(at);
    if (Number.isNaN(when.getTime())) return setError('Tarixi düzgün yazın.');
    if (inClosedMonth(when.toISOString(), closing)) return setError('Bu tarix bağlanmış aya düşür. Bağlanmış aya yazı əlavə etmək olmur.');
    setBusy(true); setError(null);
    const err = await addFinanceTransaction({
      id, kind: two ? 'transfer' : kind, accountId: from, toAccountId: two ? to : undefined, amount: n,
      category: two ? undefined : category.trim() || undefined,
      note: note.trim() || undefined, happenedAt: when.toISOString(), createdBy: me,
    });
    setBusy(false);
    if (err) setError(err); else onDone();
  }

  const options = (skip?: string) => accounts.filter(a => a.id !== skip).map(a => <option key={a.id} value={a.id}>{a.name}</option>);

  return (
    <Modal title={FORM_TITLE[kind]} onClose={onClose}>
      <div className="space-y-3">
        <Field label={two ? 'Haradan' : 'Hesab'}>
          <select className={inputCls} value={from} onChange={e => setFrom(e.target.value)}>{options()}</select>
        </Field>
        {two && (
          <Field label="Hara">
            <select className={inputCls} value={to === from ? '' : to} onChange={e => setTo(e.target.value)}>
              <option value="" disabled>— seçin —</option>
              {options(from)}
            </select>
          </Field>
        )}
        <Field label="Məbləğ, ₼"><input className={inputCls} inputMode="decimal" autoFocus value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" /></Field>
        {short && <p className="text-xs text-amber-700">Bu hesabda {money(balance[from] ?? 0)} var. Yazılsa, qalıq mənfi olacaq.</p>}
        {!two && (
          <Field label="Kateqoriya">
            <input className={inputCls} list="finance-categories" maxLength={60} value={category} onChange={e => setCategory(e.target.value)} placeholder="seçin və ya yazın" />
            <datalist id="finance-categories">{categories.map(c => <option key={c} value={c} />)}</datalist>
          </Field>
        )}
        <Field label="Tarix"><input type="datetime-local" className={inputCls} value={at} onChange={e => setAt(e.target.value)} /></Field>
        <Field label="Qeyd"><input className={inputCls} maxLength={300} value={note} onChange={e => setNote(e.target.value)} placeholder="istəyə görə" /></Field>
        {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button className={btnPrimary} disabled={busy} onClick={save}>Yaz</button>
          <button className={btnGhost} onClick={onClose}>Bağla</button>
        </div>
      </div>
    </Modal>
  );
}

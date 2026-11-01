// Runs the app's own money code on every restaurant's real data on production
// and compares it with the database: Statistika, payments, Kassa shifts,
// couriers, Anbar and suppliers.
//
//   npm run check-money                    yesterday, every active restaurant
//   npm run check-money -- --all           every day from the start
//   npm run check-money -- --company=ixlas one restaurant (name or id)
//   npm run check-money -- --day=2026-10-31
//
// PRODUCTION IS ONLY EVER READ. Every query runs inside a read-only
// transaction, and sql() refuses a query with a second statement or a word
// that writes. Needs SUPABASE_ACCESS_TOKEN_PROD in .env.local.

import { splitOrderItems, type OrderItemRow } from '../lib/order-items';
import { ordersInDays, revenue } from '../lib/statistics';
import { orderTotal } from '../components/seller/order-format';
import { shiftSales } from '../lib/shift-sales';
import { expectedCash } from '../lib/shift-cash';
import { courierBalances } from '../lib/courier-pending';
import { receiptDebts, supplierLedger, supplierPaid } from '../lib/supplier-debt';
import { addDays, businessDayStartUtc, businessToday, type CompanySettings } from '../lib/business-day';
import { readOnlySql } from '../lib/read-only-sql';
import type { Order, ShiftMovement } from '../types';

const PROJECT = 'laxeqbztathmxfbkkthb'; // production

async function sql<T>(query: string): Promise<T[]> {
  const body = readOnlySql(query);
  const token = process.env.SUPABASE_ACCESS_TOKEN_PROD;
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN_PROD missing from .env.local');
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: body }),
  });
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error(JSON.stringify(j));
  return j as T[];
}
const json = async <T>(query: string): Promise<T[]> =>
  (await sql<{ j: T[] | null }>(`select coalesce(json_agg(x), '[]') j from (${query}) x`))[0].j ?? [];

const uuid = (s: string) => { if (!/^[0-9a-f-]{36}$/i.test(s)) throw new Error(`bad id ${s}`); return `'${s}'`; };
const iso = (d: Date) => `'${d.toISOString()}'`;
const r2 = (n: number) => Math.round(n * 100) / 100;
const off = (a: number, b: number) => Math.abs(a - b) > 0.005;
const money = (n: number) => `${r2(n).toFixed(2)} ₼`;

type Company = { id: string; name: string; timezone: string | null; work_open: string | null; work_close: string | null };
type Result = { part: string; problems: string[]; note: string };

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? 'yes']));

async function checkCompany(c: Company): Promise<Result[] | null> {
  const s: CompanySettings = { timezone: c.timezone || 'Asia/Baku', workOpen: c.work_open || '00:00', workClose: c.work_close || '00:00' };
  const C = uuid(c.id);
  const all = !!args.all;
  const day = typeof args.day === 'string' && args.day !== 'yes' ? args.day : addDays(businessToday(s), -1);
  const from = businessDayStartUtc(day, s), to = businessDayStartUtc(addDays(day, 1), s);
  const inDay = (col: string) => (all ? 'true' : `${col} >= ${iso(from)} and ${col} < ${iso(to)}`);
  const results: Result[] = [];

  // ── Statistika and payments: every order's total, the app's way and SQL's ──
  type Row = { id: string; order_number: number; status: string; created_at: string; discount_amount: number | null;
    service_charge_percent: number | null; cash_amount: number | null; card_amount: number | null; courier_debt: number | null;
    db_total: number; items: OrderItemRow[] | null };
  const rows = await json<Row>(`select o.id, o.order_number, o.status, o.created_at, o.discount_amount, o.service_charge_percent,
      o.cash_amount, o.card_amount, o.courier_debt,
      round(x.dishes + round(x.dishes * coalesce(o.service_charge_percent, 0) / 100, 2) - coalesce(o.discount_amount, 0), 2) db_total,
      (select json_agg(i) from order_items i where i.order_id = o.id) items
    from orders o cross join lateral (select coalesce(sum(menu_item_price * quantity), 0) dishes
      from order_items i where i.order_id = o.id and i.removed_at is null) x
    where o.company_id = ${C} and o.status = 'ödənilib' and ${inDay('o.created_at')}`);
  const paid = rows.map(r => ({
    id: r.id, orderNumber: r.order_number, tableNumber: 0, status: r.status, createdAt: r.created_at,
    discountAmount: r.discount_amount != null ? Number(r.discount_amount) : undefined,
    serviceChargePercent: r.service_charge_percent != null ? Number(r.service_charge_percent) : undefined,
    items: splitOrderItems(r.items).items,
  } as Order));
  const counted = all ? paid : ordersInDays(paid, s, day, day);
  if (!all && counted.length === 0) return null;

  const statProblems: string[] = [];
  const payProblems: string[] = [];
  paid.forEach((o, i) => {
    const r = rows[i];
    if (off(orderTotal(o), Number(r.db_total))) statProblems.push(`#${r.order_number}: app ${money(orderTotal(o))}, database ${money(Number(r.db_total))}`);
    const taken = Number(r.cash_amount ?? 0) + Number(r.card_amount ?? 0) + Number(r.courier_debt ?? 0);
    if (off(taken, orderTotal(o))) payProblems.push(`#${r.order_number}: bill ${money(orderTotal(o))}, paid ${money(taken)}`);
  });
  if (!all && counted.length !== paid.length) statProblems.push(`${paid.length - counted.length} order(s) fall outside the business day`);
  results.push({ part: 'Statistika', problems: statProblems, note: `${counted.length} orders, ${money(revenue(counted))}` });
  results.push({ part: 'Payments', problems: payProblems, note: '' });

  // ── Kassa: each shift closed that day, recounted ──
  type Shift = { opened_at: string; closed_at: string; opening_cash: number; expected_cash: number | null; card_sales: number | null; movements: ShiftMovement[] | null };
  const shifts = await json<Shift>(`select opened_at, closed_at, opening_cash, expected_cash, card_sales, movements
    from cash_shifts where company_id = ${C} and closed_at is not null and ${inDay('closed_at')} order by opened_at`);
  const shiftProblems: string[] = [];
  if (shifts.length) {
    const since = iso(new Date(shifts[0].opened_at));
    type Sale = { paid_at: string; cash_amount: number; card_amount: number; courier_debt: number; courier_cash: number; courier_card: number };
    const sales = await json<Sale>(`select paid_at, cash_amount, card_amount, courier_debt, courier_cash, courier_card from orders
      where company_id = ${C} and status = 'ödənilib' and paid_at >= ${since}`);
    const cardPays = await json<{ created_at: string; amount: number }>(`select created_at, amount from courier_payments
      where company_id = ${C} and method = 'kart' and created_at >= ${since}`);
    for (const sh of shifts) {
      const a = +new Date(sh.opened_at), b = +new Date(sh.closed_at);
      const within = (at: string) => +new Date(at) >= a && +new Date(at) <= b;
      const t = shiftSales(sales.filter(o => within(o.paid_at)), cardPays.filter(p => within(p.created_at)));
      const drawer = expectedCash({ openingCash: Number(sh.opening_cash), movements: sh.movements ?? [] }, t.cash);
      const when = sh.opened_at.slice(0, 16).replace('T', ' ');
      if (sh.card_sales != null && off(t.card, Number(sh.card_sales))) shiftProblems.push(`shift ${when}: card ${money(t.card)}, saved ${money(Number(sh.card_sales))}`);
      if (sh.expected_cash != null && off(drawer, Number(sh.expected_cash))) shiftProblems.push(`shift ${when}: drawer ${money(drawer)}, saved ${money(Number(sh.expected_cash))}`);
    }
  }
  results.push({ part: 'Kassa', problems: shiftProblems, note: `${shifts.length} shift(s)` });

  // ── Couriers: today's debts, the app's way and the database's ──
  const couriers = await json<{ id: string; name: string; db: number }>(`select id, name, courier_outstanding(id) db from couriers where company_id = ${C}`);
  const courierProblems: string[] = [];
  if (couriers.length) {
    const balance = courierBalances(
      await json(`select courier_id, courier_debt from orders where company_id = ${C} and status = 'ödənilib' and courier_id is not null`),
      await json(`select courier_id, amount from courier_payments where company_id = ${C}`),
    );
    for (const k of couriers) if (off(balance[k.id] ?? 0, Number(k.db))) courierProblems.push(`${k.name}: app ${money(balance[k.id] ?? 0)}, database ${money(Number(k.db))}`);
  }
  results.push({ part: 'Couriers', problems: courierProblems, note: `${couriers.length} courier(s)` });

  // ── Anbar: balances against movements; each order's stock against its recipe ──
  const anbarProblems = (await json<{ name: string; balance: number; moves: number }>(`select i.name, b.qty balance,
      coalesce((select sum(m.qty) from stock_movements m where m.stock_item_id = b.stock_item_id and m.warehouse_id = b.warehouse_id), 0) moves
    from stock_balances b join stock_items i on i.id = b.stock_item_id
    where b.company_id = ${C} and abs(b.qty - coalesce((select sum(m.qty) from stock_movements m
      where m.stock_item_id = b.stock_item_id and m.warehouse_id = b.warehouse_id), 0)) > 0.0001`))
    .map(x => `${x.name.trim()}: balance ${x.balance}, movements add to ${x.moves}`);
  const stockOff = await json<{ order_number: number; name: string; expected: number; taken: number }>(`
    with o as (select id::text id, order_number, status from orders where company_id = ${C} and ${inDay('created_at')}),
    exp as (select o.id, l.stock_item_id, sum(l.qty) q from o cross join lateral order_stock_lines(o.id, ${C}::uuid) l
      where o.status not in ('ləğv edildi', 'silinib', 'gözləyir') group by 1, 2),
    got as (select m.order_id::text id, m.stock_item_id, -sum(m.qty) q from stock_movements m join o on o.id = m.order_id::text
      where m.company_id = ${C} and m.reason in ('sale', 'sale_void') group by 1, 2),
    j as (select coalesce(e.id, g.id) id, coalesce(e.stock_item_id, g.stock_item_id) item, coalesce(e.q, 0) expected, coalesce(g.q, 0) taken
      from exp e full join got g on g.id = e.id and g.stock_item_id = e.stock_item_id)
    select o.order_number, i.name, j.expected, j.taken from j join o on o.id = j.id join stock_items i on i.id = j.item
    where abs(j.expected - j.taken) > 0.0001 order by o.order_number`);
  for (const x of stockOff) anbarProblems.push(`#${x.order_number} ${x.name.trim()}: recipe ${Number(x.expected)}, taken ${Number(x.taken)}`);
  results.push({ part: 'Anbar', problems: anbarProblems, note: '' });

  // ── Suppliers: today's debts, the app's way and SQL's ──
  type Receipt = { id: string; supplier_id: string | null; total: number; paid_amount: number; voided_at: string | null; created_at: string };
  const receipts = await json<Receipt>(`select id, supplier_id, total, paid_amount, voided_at, created_at from stock_receipts where company_id = ${C}`);
  const supPays = await json<{ supplier_id: string | null; amount: number }>(`select supplier_id, amount from supplier_payments where company_id = ${C}`);
  const supplierProblems: string[] = [];
  if (receipts.length || supPays.length) {
    const ledger = supplierLedger(receipts, supPays);
    const debts = receiptDebts(receipts.map(r => ({ id: r.id, supplierId: r.supplier_id ?? undefined, total: Number(r.total),
      paidAmount: Number(r.paid_amount ?? 0), createdAt: r.created_at, voidedAt: r.voided_at ?? undefined })), supplierPaid(supPays));
    const db = await json<{ supplier_id: string; name: string; total: number; paid: number }>(`select s.id supplier_id, s.name,
        coalesce((select sum(total) from stock_receipts r where r.supplier_id = s.id and r.voided_at is null), 0) total,
        coalesce((select sum(paid_amount) from stock_receipts r where r.supplier_id = s.id and r.voided_at is null), 0)
          + coalesce((select sum(amount) from supplier_payments p where p.supplier_id = s.id), 0) paid
      from suppliers s where s.company_id = ${C}`);
    for (const x of db) {
      const l = ledger[x.supplier_id] ?? { total: 0, paid: 0, debt: 0 };
      const onReceipts = receipts.filter(r => r.supplier_id === x.supplier_id && !r.voided_at).reduce((t, r) => t + (debts[r.id] ?? 0), 0);
      if (off(l.total, Number(x.total)) || off(l.paid, Number(x.paid))) supplierProblems.push(`${x.name}: app ${money(l.total)} / ${money(l.paid)}, database ${money(Number(x.total))} / ${money(Number(x.paid))}`);
      else if (l.debt > 0 && off(onReceipts, l.debt)) supplierProblems.push(`${x.name}: receipts add to ${money(onReceipts)}, debt ${money(l.debt)}`);
    }
  }
  results.push({ part: 'Suppliers', problems: supplierProblems, note: '' });
  return results;
}

async function main() {
  let companies = await json<Company>(`select id, name, timezone, work_open, work_close from companies
    where trashed_at is null and active order by name`);
  if (typeof args.company === 'string') {
    const want = args.company.toLowerCase();
    companies = companies.filter(c => c.id === want || c.name.toLowerCase().includes(want));
    if (!companies.length) throw new Error(`no restaurant matches "${args.company}"`);
  }
  console.log(`PRODUCTION, read only · ${args.all ? 'every day' : typeof args.day === 'string' ? args.day : 'yesterday'} · ${companies.length} restaurant(s)\n`);

  let bad = 0, checked = 0;
  for (const c of companies) {
    const res = await checkCompany(c);
    if (!res) continue;
    checked++;
    const problems = res.filter(r => r.problems.length);
    bad += problems.length ? 1 : 0;
    console.log(`${problems.length ? '✗' : '✓'} ${c.name}`);
    for (const r of res) {
      console.log(`   ${r.part.padEnd(11)} ${r.problems.length ? `${r.problems.length} differ` : 'OK'}${r.note ? `  (${r.note})` : ''}`);
      for (const p of r.problems.slice(0, 8)) console.log(`      ${p}`);
      if (r.problems.length > 8) console.log(`      … and ${r.problems.length - 8} more`);
    }
  }
  console.log(`\n${checked} restaurant(s) with orders checked, ${bad ? `${bad} with differences` : 'all OK'}`);
  process.exit(bad ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });

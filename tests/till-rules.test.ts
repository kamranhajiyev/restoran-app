// 2026-10-24: a seller could take a dish off after the guest saw the bill,
// close an order without payment, or give a discount, and nobody was asked.
// Now each role's actions are free, need a manager's PIN, or are not allowed
// (lib/till-rules.ts), on the browser till, the exe and the APK alike.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  TILL_RULES_NEW, addAction, approvedBy, cleanRules, fixedRule, managerByPinOffline, removalAction, ruleFor, rulesApply, strictest,
} from '@/lib/till-rules';
import type { Staff } from '@/types';

const sql = readFileSync('supabase/migrations/20261029_till_permissions.sql', 'utf8');
const seller = readFileSync('app/seller/page.tsx', 'utf8');

// crypt('4821', gen_salt('bf', 8)) from Postgres: what the database stores as approve_hash.
const HASH_4821 = '$2a$08$2qJjxhvx0PHkiiAsw70sjOLLVN/wElI4A7IZDFqeKh4VgZcjU3FTa';
const person = (over: Partial<Staff>): Staff => ({ id: 'x', name: 'X', active: true, createdAt: '', ...over });

describe('the rules', () => {
  it('leave a restaurant that never set them free, and never ask a manager', () => {
    expect(ruleFor(null, 'seller', 'cancel')).toBe('free');
    expect(ruleFor(TILL_RULES_NEW, 'manager', 'cancel')).toBe('free');
    expect(ruleFor(TILL_RULES_NEW, 'seller', 'cancel')).toBe('pin');
    expect(ruleFor(TILL_RULES_NEW, 'waiter', 'cancel')).toBe('deny');
  });

  it('ask once for an edit, by its strictest part', () => {
    const rules = { seller: { remove_item: 'free', add_after_bill: 'pin', remove_after_bill: 'deny' } } as const;
    expect(strictest(rules, 'seller', ['remove_item', 'add_after_bill'])).toEqual({ rule: 'pin', action: 'add_after_bill' });
    expect(strictest(rules, 'seller', ['add_after_bill', 'remove_after_bill']).rule).toBe('deny');
    expect(strictest(rules, 'seller', [])).toEqual({ rule: 'free', action: null });
  });

  it('only apply where people sign in with PINs', () => {
    expect(rulesApply([])).toBe(false);
    expect(rulesApply([{ active: false }])).toBe(false);
    expect(rulesApply([{ active: true }])).toBe(true);
  });

  it('start a new restaurant with the same set the database gives it', () => {
    const def = sql.match(/till_rules set default '([\s\S]*?)'::jsonb/)![1];
    expect(JSON.parse(def)).toEqual(TILL_RULES_NEW);
  });

  it('are never turned free, or written over, by a read that failed', () => {
    expect(readFileSync('lib/store.ts', 'utf8')).toMatch(/if \(error \|\| !data\) return undefined;\s+return cleanRules\(data\.till_rules\)/);
    expect(seller).toMatch(/if \(st\.rules !== undefined\) setTillRules\(st\.rules\)/);
    expect(seller).toMatch(/'tillRules' in d \? cleanRules\(d\.tillRules\) : undefined/);
    expect(readFileSync('app/api/public-staff/route.ts', 'utf8')).toMatch(/company\.error \? \{\} : \{ tillRules:/);
    expect(readFileSync('components/TillRulesPanel.tsx', 'utf8')).toMatch(/if \(r === undefined\) \{ setError\('İcazələr yüklənmədi'\); return; \}/);
  });

  it('can be read by admin and the signed-in till (companies is granted column by column)', () => {
    expect(sql).toMatch(/grant select \(till_rules\) on public\.companies to authenticated;/);
  });

  it('come with the staff list, so they cost the till no request of their own', () => {
    expect(seller).not.toMatch(/loadTillRules/);
    expect(seller.match(/readTerminalStaff\(overrideCompanyId\)/g)?.length).toBe(2);
    expect(seller.match(/fetchStaffAndRulesOrNull\(\)/g)?.length).toBe(3);
    expect(sql).toMatch(/'rules', \(select c\.till_rules from companies c/);
  });

  it('drop anything that is not a known rule', () => {
    expect(cleanRules({ seller: { cancel: 'pin', discount: 'maybe', other: 'deny' }, boss: {} })).toEqual({ seller: { cancel: 'pin' } });
    expect(cleanRules(null)).toBeNull();
  });
});

describe('after the bill', () => {
  const order = { billPrintedAt: '2026-10-24T12:00:00Z' };
  it('is a line that was on the printed bill', () => {
    expect(removalAction(order, { createdAt: '2026-10-24T11:59:00Z' })).toBe('remove_after_bill');
    expect(removalAction(order, { createdAt: '2026-10-24T12:01:00Z' })).toBe('remove_item');
    expect(removalAction({}, { createdAt: '2026-10-24T11:59:00Z' })).toBe('remove_item');
  });

  it('makes adding to the order need the after-bill rule', () => {
    expect(addAction(order)).toBe('add_after_bill');
    expect(addAction({})).toBeNull();
  });

  it('is saved on the order by the browser till, the exe and the APK', () => {
    expect(seller).toMatch(/'\/api\/bill-printed'/);
    expect(seller).toMatch(/markBillPrinted\(order\.id, at\)/);
    expect(readFileSync('lib/till-store/write.ts', 'utf8')).toMatch(/case '\/api\/bill-printed':\s+return applyBillPrinted/);
    expect(readFileSync('app/api/public-orders/route.ts', 'utf8')).toMatch(/billPrintedAt: o\.bill_printed_at/);
    expect(readFileSync('lib/store.ts', 'utf8')).toMatch(/billPrintedAt: o\.bill_printed_at/);
  });
});

describe("a manager's PIN offline", () => {
  it('opens with the hash the database makes', async () => {
    const boss = person({ id: 'm', name: 'Kamran', role: 'manager', approveHash: HASH_4821 });
    expect((await managerByPinOffline('4821', [boss]))?.name).toBe('Kamran');
    expect(await managerByPinOffline('1111', [boss])).toBeNull();
  });

  it('is never a seller, an inactive manager, or a damaged hash', async () => {
    expect(await managerByPinOffline('4821', [person({ role: 'seller', approveHash: HASH_4821 })])).toBeNull();
    expect(await managerByPinOffline('4821', [person({ role: 'manager', active: false, approveHash: HASH_4821 })])).toBeNull();
    expect(await managerByPinOffline('4821', [person({ role: 'manager', approveHash: 'nonsense' })])).toBeNull();
  });

  it("reaches the till for managers only — sellers' hashes stay in the database", () => {
    expect(sql.slice(sql.indexOf('grant select'))).not.toMatch(/grant select[^;]*approve_hash/);
    expect(sql).toMatch(/s\.active and s\.role = 'manager' and s\.approve_hash is not null/);
    expect(readFileSync('app/api/public-staff/route.ts', 'utf8'))
      .toMatch(/approveHash: s\.role === 'manager' && s\.active \? s\.approve_hash/);
  });

  it('is never something the public key can run', () => {
    for (const fn of ['create_staff', 'update_staff', 'till_staff_extras', 'set_till_rules']) {
      expect(sql).toMatch(new RegExp(`revoke execute on function public\\.${fn}\\([^)]*\\) from public, anon`));
    }
  });
});

describe('the seller page', () => {
  it('names the approving manager on the order', () => {
    expect(approvedBy('Aysel', 'Kamran')).toBe('Aysel (təsdiq: Kamran)');
    expect(approvedBy('Aysel', null)).toBe('Aysel');
    expect(seller).toMatch(/const removedBy = approvedBy\(effectiveSeller, approver\)/);
    expect(seller).toMatch(/const by = approvedBy\(effectiveSeller, g\.approver\)/);
  });

  it('asks before each of the five actions', () => {
    expect(seller).toMatch(/refused\(removalAction\(order, oi\)\)/);
    expect(seller).toMatch(/actions\.push\(removalAction\(target, oi\)\)/);
    expect(seller).toMatch(/cart\.length > 0 \? addAction\(target\)/);
    expect(seller).toMatch(/await guard\(\['cancel'\]\)/);
    expect(seller).toMatch(/discountAmt > 0 && !\(await guard\(\['discount'\]\)\)\.ok/);
  });

  it('asks before Tarixçə opens, and closes it when someone else signs in', () => {
    expect(ruleFor(TILL_RULES_NEW, 'seller', 'view_history')).toBe('pin');
    expect(seller).toMatch(/id === 'history' && view !== 'history' && !\(await guard\(\['view_history'\]\)\)\.ok\) return;(\s+if \(id === '(kassa|couriers)' [^\n]+)+\n\s+if \(!\(await confirmDiscardRemovals/);
    expect(seller).toMatch(/setView\(v => \(v === 'history' \|\| v === 'kassa' \|\| v === 'couriers' \? 'orders' : v\)\);\s+\}, \[activeStaff\?\.id\]\);/);
    // The only way into Tarixçə is the menu, through handleNav.
    expect(seller).not.toMatch(/setView\('history'\)/);
  });
});

// 2026-10-25: the owner wants waiters kept off the kassa, but someone must
// always be able to open the shift.
describe('Kassa', () => {
  it('is the owner\'s choice for the waiter, and always open to the seller and the manager', () => {
    const rules = { seller: { kassa: 'deny' }, waiter: { kassa: 'deny' } } as const;
    expect(ruleFor(rules, 'waiter', 'kassa')).toBe('deny');
    expect(ruleFor(rules, 'seller', 'kassa')).toBe('free');
    expect(ruleFor(rules, 'manager', 'kassa')).toBe('free');
    expect(fixedRule('seller', 'kassa')).toBe('free');
    expect(fixedRule('waiter', 'kassa')).toBeNull();
    // A restaurant that set rules before Kassa existed keeps it open.
    expect(ruleFor(TILL_RULES_NEW, 'waiter', 'kassa')).toBe('free');
  });

  it('is locked on the İcazələr page where it is fixed', () => {
    expect(readFileSync('components/TillRulesPanel.tsx', 'utf8')).toMatch(/disabled=\{saving \|\| !!fixed\}/);
  });

  it('when closed, hides the tab and "Növbəni aç", and asks for a PIN on both ways in', () => {
    expect(seller).toMatch(/const kassaShown = kassaOn && !\(rulesOn && ruleFor\(tillRules, myRole, 'kassa'\) === 'deny'\)/);
    expect(seller).not.toMatch(/\(kassaOn \? \[\{ id: 'kassa'/);
    expect(seller.match(/\(kassaShown \? \[\{ id: 'kassa'/g)?.length).toBe(2);
    expect(seller).toMatch(/if \(id === 'kassa' && !kassaShown\) return;/);
    expect(seller).toMatch(/if \(!shift && kassaOn && !kassaShown\) \{/);
    expect(seller).toMatch(/async function handleOpenShift\(\) \{\s+if \(!\(await guard\(\['kassa'\]\)\)\.ok\) return;/);
    expect(seller).toMatch(/id === 'kassa' && view !== 'kassa' && !\(await guard\(\['kassa'\]\)\)\.ok/);
    expect(seller).not.toMatch(/setView\('kassa'\)/);
  });

  it('Kuryerlər works the same way: hidden when closed, a PIN when held back', () => {
    expect(ruleFor({ waiter: { couriers: 'deny' } }, 'waiter', 'couriers')).toBe('deny');
    expect(ruleFor(TILL_RULES_NEW, 'waiter', 'couriers')).toBe('free');
    expect(seller).toMatch(/const couriersShown = deliveryOn && !\(rulesOn && ruleFor\(tillRules, myRole, 'couriers'\) === 'deny'\)/);
    expect(seller).not.toMatch(/\(deliveryOn \? \[\{ id: 'couriers'/);
    expect(seller.match(/\(couriersShown \? \[\{ id: 'couriers'/g)?.length).toBe(2);
    expect(seller).toMatch(/if \(id === 'couriers' && !couriersShown\) return;/);
    expect(seller).toMatch(/id === 'couriers' && view !== 'couriers' && !\(await guard\(\['couriers'\]\)\)\.ok/);
    expect(seller).not.toMatch(/setView\('couriers'\)/);
  });

  it('lets a waiting till start when the shift is opened elsewhere', () => {
    expect(seller).toMatch(/else if \(open && !shift\) setShift\(open\);/);
  });
});

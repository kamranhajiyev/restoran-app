// Who may do what on the till, and when a manager's PIN is asked for.
//
// As in Clopos: each PIN person has a role, and the owner sets every action
// for each role to free, a manager's PIN, or not allowed (Əməkdaşlar →
// İcazələr). Managers are never asked. The browser till, the exe and the APK
// all decide through `ruleFor`, so the three cannot disagree.
//
// A manager's PIN is checked by the server when there is a line. Offline it is
// checked here against the managers' approval hashes the till keeps (see
// 20261029_till_permissions.sql for what that does and does not protect).

import bcrypt from 'bcryptjs';
import type { Order, OrderItem, Staff, StaffRole } from '../types';

export type TillAction = 'remove_item' | 'remove_after_bill' | 'add_after_bill' | 'cancel' | 'discount' | 'view_history' | 'kassa' | 'couriers';
export type Rule = 'free' | 'pin' | 'deny';
/** The roles the owner sets rules for. A manager needs none. */
export type RuledRole = Exclude<StaffRole, 'manager'>;
export type TillRules = Partial<Record<RuledRole, Partial<Record<TillAction, Rule>>>>;

export const TILL_ACTIONS: { id: TillAction; label: string; hint: string }[] = [
  { id: 'remove_item',       label: 'Məhsulu silmək',             hint: 'Mətbəxə göndərilmiş məhsulu sifarişdən çıxarmaq' },
  { id: 'remove_after_bill', label: 'Hesabdan sonra silmək',      hint: 'Hesab çap olunandan sonra ondakı məhsulu çıxarmaq' },
  { id: 'add_after_bill',    label: 'Hesabdan sonra əlavə etmək', hint: 'Hesab çap olunmuş sifarişə məhsul əlavə etmək' },
  { id: 'cancel',            label: 'Ödənişsiz bağlamaq',         hint: 'Sifarişi pul almadan bağlamaq' },
  { id: 'discount',          label: 'Endirim etmək',              hint: 'Ödənişdə endirim vermək' },
  { id: 'view_history',      label: 'Tarixçəyə baxmaq',           hint: 'Keçmiş sifarişləri və günün satışını görmək' },
  { id: 'kassa',             label: 'Kassa',                      hint: 'Kassa bölməsini görmək, növbəni açmaq və bağlamaq' },
  { id: 'couriers',          label: 'Kuryerlər',                  hint: 'Kuryerlər bölməsini görmək və onlardan pul qəbul etmək' },
];

/**
 * Rules the owner cannot change. The seller keeps the kassa: closed to the
 * seller and the waiter alike, nobody but a manager could open a shift.
 */
const FIXED: Partial<Record<RuledRole, Partial<Record<TillAction, Rule>>>> = {
  seller: { kassa: 'free' },
};

/** The rule this role always has for this action, or null when the owner picks. */
export function fixedRule(role: RuledRole, action: TillAction): Rule | null {
  return FIXED[role]?.[action] ?? null;
}

export const ROLE_NAMES: Record<StaffRole, string> = {
  seller: 'Satıcı',
  waiter: 'Ofisiant',
  manager: 'Menecer',
};

/** What a new restaurant starts with — the same as the column default in the migration. */
export const TILL_RULES_NEW: Required<TillRules> = {
  seller: { remove_item: 'free', remove_after_bill: 'pin', add_after_bill: 'pin', cancel: 'pin', discount: 'pin', view_history: 'pin' },
  waiter: { remove_item: 'free', remove_after_bill: 'pin', add_after_bill: 'pin', cancel: 'deny', discount: 'pin', view_history: 'pin' },
};

const STRICTNESS: Record<Rule, number> = { free: 0, pin: 1, deny: 2 };

/**
 * The rule for one person and one action. No rules (a restaurant that never
 * set them), a manager, or someone not on the list → free.
 */
export function ruleFor(rules: TillRules | null | undefined, role: StaffRole | undefined, action: TillAction): Rule {
  if (!rules || !role || role === 'manager') return 'free';
  const fixed = fixedRule(role, action);
  if (fixed) return fixed;
  const r = rules[role]?.[action];
  return r === 'pin' || r === 'deny' ? r : 'free';
}

/** Several actions at once (a removal and an addition saved together) ask once, by the strictest. */
export function strictest(rules: TillRules | null | undefined, role: StaffRole | undefined, actions: TillAction[]): { rule: Rule; action: TillAction | null } {
  let out: { rule: Rule; action: TillAction | null } = { rule: 'free', action: null };
  for (const a of actions) {
    const r = ruleFor(rules, role, a);
    if (STRICTNESS[r] > STRICTNESS[out.rule]) out = { rule: r, action: a };
  }
  return out;
}

/** Was this line on the bill the guest was shown? Then taking it off is "after the bill". */
export function removalAction(order: Pick<Order, 'billPrintedAt'>, item: Pick<OrderItem, 'createdAt'>): TillAction {
  if (!order.billPrintedAt) return 'remove_item';
  // A line with no time came with the order itself, so it was on the bill.
  if (!item.createdAt) return 'remove_after_bill';
  return Date.parse(item.createdAt) <= Date.parse(order.billPrintedAt) ? 'remove_after_bill' : 'remove_item';
}

/** Adding to an order whose bill is already printed. */
export function addAction(order: Pick<Order, 'billPrintedAt'>): TillAction | null {
  return order.billPrintedAt ? 'add_after_bill' : null;
}

/** "Aysel (təsdiq: Kamran)" — the approver goes on the order beside whoever did it. */
export function approvedBy(by: string, approver: string | null | undefined): string {
  return approver ? `${by} (təsdiq: ${approver})` : by;
}

/** Whether the rules apply at all: only where people sign in with PINs. */
export function rulesApply(staff: Pick<Staff, 'active'>[]): boolean {
  return staff.some(s => s.active);
}

/** A manager's PIN, checked against the hashes this till holds. Null when none matches. */
export async function managerByPinOffline(pin: string, staff: Staff[]): Promise<Staff | null> {
  for (const s of staff) {
    if (!s.active || s.role !== 'manager' || !s.approveHash) continue;
    try {
      if (await bcrypt.compare(pin, s.approveHash)) return s;
    } catch {
      // A damaged hash is just not a match.
    }
  }
  return null;
}

/** A rules object from the database or the till's copy, with anything unknown dropped. */
export function cleanRules(raw: unknown): TillRules | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: TillRules = {};
  for (const role of ['seller', 'waiter'] as const) {
    const src = (raw as Record<string, unknown>)[role];
    if (!src || typeof src !== 'object') continue;
    const row: Partial<Record<TillAction, Rule>> = {};
    for (const { id } of TILL_ACTIONS) {
      const v = (src as Record<string, unknown>)[id];
      if (v === 'free' || v === 'pin' || v === 'deny') row[id] = v;
    }
    out[role] = row;
  }
  return out;
}

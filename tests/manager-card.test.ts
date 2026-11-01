// 2026-11-01: some venues have an RFID reader on the till and want a manager
// to approve by tapping a card instead of typing a PIN. The owner picks
// "Yalnız PIN", "Yalnız kart" or "Kart və ya PIN" in İcazələr, on the
// browser till, the exe and the APK alike.

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CARD_GAP_MS, cardCatcher, cardNumber } from '@/lib/card-reader';
import { TILL_RULES_NEW, approveWith, cleanRules, managerByCardOffline } from '@/lib/till-rules';
import type { Staff } from '@/types';

const sql = readFileSync('supabase/migrations/20261105_manager_cards.sql', 'utf8');
const seller = readFileSync('app/seller/page.tsx', 'utf8');
const pad = readFileSync('components/seller/ApprovalPad.tsx', 'utf8');

// The card in the photo: printed "0012677920 193,29472".
const HASH_CARD = '$2a$08$JuqoMQgfATuPrQQ11Jol9ugIra5FX8JOzm7Df.qSRHeUD5/Zz4x02';
const person = (over: Partial<Staff>): Staff => ({ id: 'x', name: 'X', active: true, createdAt: '', ...over });

describe("a card's number", () => {
  it('is the same however the reader or the card prints it', () => {
    expect(cardNumber('0012677920')).toBe('12677920');
    expect(cardNumber('193,29472')).toBe('12677920');
    expect(cardNumber('193.29472')).toBe('12677920');
    expect(cardNumber(' 12677920 ')).toBe('12677920');
  });

  it('matches the pair printed beside it when the ten-digit number is above 16777215', () => {
    // The pair keeps only the low 24 bits; the top byte is not printed in it.
    const pair = (n: number) => `${Math.floor(n / 65536) % 256},${n % 65536}`;
    for (const n of [3123456789, 1023456789, 12677920]) expect(cardNumber(String(n).padStart(10, '0'))).toBe(cardNumber(pair(n)));
    expect(cardNumber('3123456789')).not.toBe(cardNumber('3123456788'));
  });

  it('is nothing for what is not a card', () => {
    expect(cardNumber('')).toBeNull();
    expect(cardNumber('0000')).toBeNull();
    expect(cardNumber('12a4')).toBeNull();
    expect(cardNumber('300,1')).toBeNull();
  });
});

describe('the reader on the keyboard', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function run(keys: string, gap: number, enter = true) {
    const cards: string[] = [];
    const typed: string[] = [];
    const c = cardCatcher(x => cards.push(x), k => typed.push(k));
    for (const k of keys) { c.key(k); vi.advanceTimersByTime(gap); }
    const ate = enter ? c.enter() : false;
    vi.advanceTimersByTime(CARD_GAP_MS * 2);
    return { cards, typed: typed.join(''), ate };
  }

  it('is a card when a burst of keys ends in Enter', () => {
    expect(run('0012677920', 5)).toEqual({ cards: ['12677920'], typed: '', ate: true });
  });

  it('is still a card when the reader sends no Enter', () => {
    expect(run('193,29472', 5, false)).toEqual({ cards: ['12677920'], typed: '', ate: false });
  });

  it('is a person when the keys come at typing speed', () => {
    expect(run('4821', 200, false)).toEqual({ cards: [], typed: '4821', ate: false });
  });

  it('is a person when a quick burst is too short for a card', () => {
    expect(run('48', 5)).toEqual({ cards: [], typed: '48', ate: false });
  });
});

describe('the owner\'s choice', () => {
  it('is the PIN until the owner picks a card', () => {
    expect(approveWith(null)).toBe('pin');
    expect(approveWith(TILL_RULES_NEW)).toBe('pin');
    expect(approveWith({ approve_with: 'card' })).toBe('card');
    expect(approveWith({ approve_with: 'both' })).toBe('both');
  });

  it('rides in the rules, so it reaches the exe and the APK, and nothing else does', () => {
    expect(cleanRules({ approve_with: 'card', seller: { cancel: 'pin' } })).toEqual({ approve_with: 'card', seller: { cancel: 'pin' } });
    expect(cleanRules({ approve_with: 'face' })).toEqual({});
  });

  it('survives "Tövsiyə olunanı tətbiq et"', () => {
    expect(readFileSync('components/TillRulesPanel.tsx', 'utf8'))
      .toMatch(/save\(\{ \.\.\.TILL_RULES_NEW, \.\.\.\(rules\?\.approve_with \? \{ approve_with: rules\.approve_with \} : \{\}\) \}\)/);
  });
});

describe("a manager's card offline", () => {
  it('opens with the hash a manager\'s card is saved as', async () => {
    const boss = person({ id: 'm', name: 'Kamran', role: 'manager', cardHash: HASH_CARD });
    expect((await managerByCardOffline('12677920', [boss]))?.name).toBe('Kamran');
    expect(await managerByCardOffline('12677921', [boss])).toBeNull();
  });

  it('is never a seller, an inactive manager, or a damaged hash', async () => {
    expect(await managerByCardOffline('12677920', [person({ role: 'seller', cardHash: HASH_CARD })])).toBeNull();
    expect(await managerByCardOffline('12677920', [person({ role: 'manager', active: false, cardHash: HASH_CARD })])).toBeNull();
    expect(await managerByCardOffline('12677920', [person({ role: 'manager', cardHash: 'nonsense' })])).toBeNull();
  });
});

describe('the database', () => {
  it('never lets the browser read a card hash, and gives the till managers\' only', () => {
    expect(sql).not.toMatch(/grant select[^;]*card_hash/);
    expect(sql).toMatch(/s\.active and s\.role = 'manager' and \(s\.approve_hash is not null or s\.card_hash is not null\)/);
    expect(readFileSync('app/api/public-staff/route.ts', 'utf8'))
      .toMatch(/cardHash: s\.role === 'manager' && s\.active \? s\.card_hash/);
  });

  it('lets nobody but the server check a card for any company', () => {
    expect(sql).toMatch(/revoke execute on function public\.verify_staff_card_in\(uuid, text, text\) from public, anon, authenticated;/);
    expect(sql).toMatch(/grant execute on function public\.verify_staff_card_in\(uuid, text, text\) to service_role;/);
    for (const fn of ['set_staff_card', 'verify_staff_card']) {
      expect(sql).toMatch(new RegExp(`revoke execute on function public\\.${fn}\\([^)]*\\) from public, anon`));
    }
  });

  it('counts a wrong card against the same tries as a wrong PIN', () => {
    expect(sql).toMatch(/insert into staff_pin_state/);
  });
});

describe('the till', () => {
  it('shows the owner\'s choice in both approval boxes, and checks a card like a PIN', () => {
    expect(seller.match(/mode=\{approvalMode\}/g)?.length).toBe(2);
    expect(seller.match(/onCard=\{c => void tapApprovalCard\(c\)\}/g)?.length).toBe(2);
    expect(seller).toMatch(/tillPost<CardReply>\('\/api\/verify-pin', \{ companyId: overrideCompanyId, card,/);
    expect(seller).toMatch(/await managerByCardOffline\(card, pinStaffList\)/);
    // "Yalnız kart" takes no PIN, not even from a keyboard.
    expect(seller).toMatch(/async function pressApprovalPin\(digit: string\) \{\s+if \(approvalMode === 'card'\) return;/);
  });

  it('keeps a card tap from becoming four PIN digits', () => {
    expect(pad).toMatch(/if \(cards\) catcher\.current\?\.key\(k\.digit\);/);
    expect(readFileSync('app/api/verify-pin/route.ts', 'utf8')).toMatch(/verify_staff_card_in/);
  });
});

describe('the admin staff form', () => {
  it('goes on editing a person whose card was refused, rather than making them twice', () => {
    const admin = readFileSync('app/admin/page.tsx', 'utf8');
    expect(admin).toMatch(/if \(err && made\.id\) \{[\s\S]{0,200}setEditingStaff\(fresh\.find\(x => x\.id === made\.id\) \?\? null\);/);
    expect(readFileSync('lib/store.ts', 'utf8')).toMatch(/if \(!id \|\| !card\) return \{ error: staffError\(error\), id \};/);
  });

  it('takes the card off anyone who stops being a manager, active or not', () => {
    expect(readFileSync('app/admin/page.tsx', 'utf8'))
      .toMatch(/const clear = sCardClear \|\| \(sRole !== 'manager' && editingStaff\.role === 'manager'\);/);
  });
});

// A card tapped on the PIN login screen typed ten digits into the PIN pad:
// the first four were a wrong PIN, and a few taps locked the till.
describe('the PIN login screen', () => {
  it('tells a card from a PIN and does not count it as a wrong one', () => {
    expect(seller).toMatch(/const c = cardCatcher\(\s+\(\) => \{ setPinInput\(''\); setPinMsg\('Kart yalnız menecer təsdiqi üçündür — PIN daxil edin'\); \},\s+keys => \{ void pressPinRef\.current\(keys\); \},/);
    expect(seller).toMatch(/if \(k && typeof k === 'object'\) lockCatcher\.current\?\.key\(k\.digit\);/);
  });

  it('takes digits that came together without losing one', () => {
    expect(seller).toMatch(/const next = \(pinInput \+ digit\)\.slice\(0, 4\);/);
    expect(seller).toMatch(/const next = \(approvalPin \+ digit\)\.slice\(0, 4\);/);
    expect(pad).toMatch(/if \(digits\) latest\.current\.onDigit\(digits\);/);
  });
});

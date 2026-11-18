// Mağaza modu, step 1 (SHOP-MODE.md): each company is a Restoran or a Mağaza,
// chosen by the superadmin when making it and changeable later. Every company
// that exists today must stay a restaurant, also on a database that has not
// had 20261110_company_kind.sql yet.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cleanKind, kindForInsert, KIND_OPTIONS, newCompanyRow } from '@/lib/company-kind';

const store = readFileSync('lib/store.ts', 'utf8');
const superadmin = readFileSync('app/superadmin/page.tsx', 'utf8');
const migration = readFileSync('supabase/migrations/20261110_company_kind.sql', 'utf8');

describe('company kind', () => {
  it('is a restaurant unless the database says exactly shop', () => {
    expect(cleanKind('shop')).toBe('shop');
    expect(cleanKind('restaurant')).toBe('restaurant');
    for (const v of [undefined, null, '', 'Shop', 'mağaza', 1]) expect(cleanKind(v)).toBe('restaurant');
  });

  it('offers Restoran and Mağaza, Restoran first', () => {
    expect(KIND_OPTIONS.map(o => o.label)).toEqual(['Restoran', 'Mağaza']);
  });

  it('sends nothing for a new restaurant, so creating one never needs the column', () => {
    expect(kindForInsert('restaurant')).toEqual({});
    expect(kindForInsert('shop')).toEqual({ kind: 'shop' });
    expect(store).toMatch(/from\('companies'\)\.insert\(newCompanyRow\(name, slug, kind\)\)/);
  });

  it('starts a new account with table-change slips, Kassa, Çatdırılma on and the QR menu view-only', () => {
    for (const kind of ['restaurant', 'shop'] as const) {
      expect(newCompanyRow('A', 'a', kind)).toMatchObject({
        name: 'A', slug: 'a',
        print_table_move: true, kassa_enabled: true, delivery_enabled: true, menu_only: true,
      });
    }
    expect(newCompanyRow('A', 'a', 'restaurant')).not.toHaveProperty('kind');
    expect(newCompanyRow('A', 'a', 'shop').kind).toBe('shop');
  });

  it('is read apart from the company list, so a missing column cannot empty it', () => {
    const list = store.slice(store.indexOf('export async function fetchCompanies'), store.indexOf('export async function createCompany'));
    expect(list).not.toMatch(/\bkind\b/);
    expect(store).toMatch(/export async function fetchCompanyKinds/);
  });

  it('is picked by the superadmin when creating and when editing a company', () => {
    expect(superadmin).toMatch(/createCompany\(companyName\.trim\(\), companySlug\.trim\(\)\.toLowerCase\(\), companyKind\)/);
    expect(superadmin).toMatch(/profKind !== profileCompany\.kind \? updateCompanyKind\(profileCompany\.id, profKind\)/);
    expect(superadmin).toMatch(/\|\| profKind !== snapshot\.kind/);
  });

  it('defaults every existing company to restaurant, and stays closed to the public key', () => {
    expect(migration).toMatch(/kind text not null default 'restaurant'/);
    expect(migration).toMatch(/check \(kind in \('restaurant', 'shop'\)\)/);
    expect(migration).toMatch(/grant select \(kind\) on public\.companies to authenticated;/);
    expect(migration).not.toMatch(/to anon/);
  });
});

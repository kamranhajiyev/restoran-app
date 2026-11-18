// Restoran or Mağaza (SHOP-MODE.md). The superadmin picks it when making the
// company and may change it later; the owner cannot, because it changes the
// whole app. Nothing is deleted when it changes — a restaurant's tables stay
// saved and only hide while it is a shop.

export type CompanyKind = 'restaurant' | 'shop';

export const KIND_OPTIONS: { value: CompanyKind; label: string }[] = [
  { value: 'restaurant', label: 'Restoran' },
  { value: 'shop', label: 'Mağaza' },
];

/** Whatever the database sent — a missing column, null, a typo — is a
 *  restaurant. Only an exact 'shop' turns shop mode on, so a database that has
 *  not had the migration yet keeps every company working as before. */
export function cleanKind(value: unknown): CompanyKind {
  return value === 'shop' ? 'shop' : 'restaurant';
}

/** What a new company's insert carries: nothing for a restaurant (the
 *  column's default), so creating one never depends on the column existing. */
export function kindForInsert(kind: CompanyKind): { kind?: 'shop' } {
  return kind === 'shop' ? { kind: 'shop' } : {};
}

/** How every new account starts (2026-11-18): table-change slips, Kassa and
 *  Çatdırılma on, and the QR menu only to look at — guests cannot order before
 *  the restaurant has set up its menu and printing. Set on the insert, not as
 *  column defaults, so old accounts never change. */
export const NEW_COMPANY_SETTINGS = {
  print_table_move: true,
  kassa_enabled: true,
  delivery_enabled: true,
  menu_only: true,
} as const;

export function newCompanyRow(name: string, slug: string, kind: CompanyKind) {
  return { name, slug, ...NEW_COMPANY_SETTINGS, ...kindForInsert(kind) };
}

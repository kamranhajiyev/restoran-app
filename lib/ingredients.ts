// Yeməyin tərkibi (20261115_menu_ingredients.sql): what a dish is made of, for
// guests on the QR / online menu only. One text per dish; its sizes share it.
// Not Resept — that moves stock; this is just words for the guest.

import type { CompanyKind } from './company-kind';

/** The database refuses more (menu_items_ingredients_len). */
export const INGREDIENTS_MAX = 500;

/** What gets saved: trimmed, cut to the limit, and null when empty, so a box
 *  cleared or left blank shows nothing on the menu. */
export function cleanIngredients(text: string | null | undefined): string | null {
  const t = (text ?? '').trim().slice(0, INGREDIENTS_MAX).trim();
  return t || null;
}

/** Whether admin offers the box. A shop's products have no tərkib (the user, 2026-11-18). */
export function takesIngredients(kind: CompanyKind): boolean {
  return kind !== 'shop';
}

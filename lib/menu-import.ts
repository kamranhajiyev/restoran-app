import type { ImportPreview } from './excel';

/** The rows the admin import (saveCategories + saveMenu) writes for a menu
 *  file, for scripts/import-menu.ts to put into an empty company. */
export function menuImportRows(preview: ImportPreview, companyId: string) {
  const categories = preview.newCategories.map((c, i) => ({
    name: c.name,
    available: c.available,
    qr_visible: c.qrVisible ?? true,
    position: i,
    company_id: companyId,
  }));
  const items = preview.newItems.map((m, i) => ({
    id: m.id,
    name: m.name,
    price: m.price,
    category: m.category,
    available: m.available,
    qr_visible: m.qrVisible ?? true,
    variants: m.variants ?? null,
    cost_price: m.costPrice ?? null,
    image: m.image ?? null,
    station_id: m.stationId ?? null,
    kind: m.kind ?? 'product',
    position: i,
    company_id: companyId,
  }));
  return { categories, items };
}

/** Why a company may not take a whole menu, or null when it may. The script
 *  only adds: a company that already has a menu goes through the admin import,
 *  which matches products by name instead of doubling them. */
export function importBlocked(existing: { items: number; categories: number }): string | null {
  if (existing.items > 0 || existing.categories > 0) {
    return `The company already has ${existing.items} products and ${existing.categories} categories. Use the admin import.`;
  }
  return null;
}

import * as XLSX from 'xlsx';
import { Category, MenuItem, MenuItemVariant } from '@/types';

// ─── Export ───────────────────────────────────────────────────────────────────

const COL = {
  category: 'Kateqoriya',
  name: 'Məhsul',
  price: 'Qiymət (₼)',
  cost: 'Maya dəyəri (₼)',
  available: 'Mövcud',
  variants: 'Variantlar',
} as const;

function serializeVariants(variants?: MenuItemVariant[]): string {
  if (!variants?.length) return '';
  return variants
    .map(v => `${v.name}=${v.price}${v.costPrice ? `(${v.costPrice})` : ''}`)
    .join(' | ');
}

export function exportMenuExcel(menu: MenuItem[], categories: Category[]): void {
  // Keep category order in the file
  const order = new Map(categories.map((c, i) => [c.name, i]));
  const sorted = [...menu].sort((a, b) => (order.get(a.category) ?? 999) - (order.get(b.category) ?? 999));

  const menuRows = sorted.map(m => ({
    [COL.category]: m.category,
    [COL.name]: m.name,
    [COL.price]: m.price,
    [COL.cost]: m.costPrice ?? '',
    [COL.available]: m.available ? 'Bəli' : 'Xeyr',
    [COL.variants]: serializeVariants(m.variants),
  }));
  const catRows = categories.map(c => ({ 'Ad': c.name, 'Aktiv': c.available ? 'Bəli' : 'Xeyr' }));

  const wb = XLSX.utils.book_new();
  const menuSheet = XLSX.utils.json_to_sheet(menuRows.length ? menuRows : [{ [COL.category]: '', [COL.name]: '', [COL.price]: '', [COL.cost]: '', [COL.available]: '', [COL.variants]: '' }]);
  menuSheet['!cols'] = [{ wch: 18 }, { wch: 30 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, menuSheet, 'Menyu');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(catRows), 'Kateqoriyalar');
  XLSX.writeFile(wb, `menyu-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ─── Import ───────────────────────────────────────────────────────────────────

export interface ImportPreview {
  newItems: MenuItem[];      // products not in the current menu
  updatedItems: MenuItem[];  // existing products with fields overwritten from the file
  newCategories: Category[]; // categories mentioned in the file that don't exist yet
  errors: string[];          // human-readable, with row numbers
  totalRows: number;
}

// Header matching is forgiving: case-insensitive, with/without diacritics,
// English synonyms accepted.
function headerKey(raw: string): keyof typeof COL | null {
  const h = raw.trim().toLowerCase();
  if (h.startsWith('kateq') || h === 'category') return 'category';
  if (h.startsWith('məhsul') || h.startsWith('mehsul') || h === 'ad' || h === 'name' || h === 'product') return 'name';
  if (h.startsWith('qiymət') || h.startsWith('qiymet') || h === 'price') return 'price';
  if (h.startsWith('maya') || h === 'cost' || h.startsWith('cost')) return 'cost';
  if (h.startsWith('mövcud') || h.startsWith('movcud') || h === 'available' || h === 'aktiv') return 'available';
  if (h.startsWith('variant')) return 'variants';
  return null;
}

function parseBool(raw: unknown): boolean {
  const s = String(raw ?? '').trim().toLowerCase();
  if (['xeyr', 'no', 'false', '0', 'yox'].includes(s)) return false;
  return true; // default: available
}

function parsePrice(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = parseFloat(String(raw).replace(',', '.').replace('₼', '').trim());
  return isNaN(n) || n < 0 ? null : Math.round(n * 100) / 100;
}

function parseVariants(raw: unknown, rowNum: number, errors: string[]): MenuItemVariant[] | undefined {
  const s = String(raw ?? '').trim();
  if (!s) return undefined;
  const variants: MenuItemVariant[] = [];
  for (const part of s.split('|')) {
    const m = part.trim().match(/^(.+?)=([\d.,]+)(?:\(([\d.,]+)\))?$/);
    if (!m) {
      errors.push(`Sətir ${rowNum}: variant formatı yanlışdır — "${part.trim()}" (düzgün: Ad=Qiymət | Ad=Qiymət(Maya))`);
      continue;
    }
    const price = parsePrice(m[2]);
    if (price === null) { errors.push(`Sətir ${rowNum}: variant qiyməti yanlışdır — "${part.trim()}"`); continue; }
    const cost = m[3] ? parsePrice(m[3]) : null;
    variants.push({
      id: crypto.randomUUID(),
      name: m[1].trim(),
      price,
      ...(cost !== null && cost !== undefined ? { costPrice: cost } : {}),
    });
  }
  return variants.length ? variants : undefined;
}

export async function parseMenuFile(
  file: File,
  existingMenu: MenuItem[],
  existingCategories: Category[],
): Promise<ImportPreview> {
  const errors: string[] = [];
  const wb = XLSX.read(await file.arrayBuffer());

  const menuSheetName = wb.SheetNames.find(n => n.trim().toLowerCase() === 'menyu') ?? wb.SheetNames[0];
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(wb.Sheets[menuSheetName], { defval: '' });

  // Category sheet (optional) — provides availability for new categories
  const catSheetName = wb.SheetNames.find(n => n.trim().toLowerCase().startsWith('kateq'));
  const catAvailability = new Map<string, boolean>();
  if (catSheetName) {
    const catRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(wb.Sheets[catSheetName], { defval: '' });
    for (const r of catRows) {
      const name = String(r['Ad'] ?? r['ad'] ?? r['Name'] ?? '').trim();
      if (name) catAvailability.set(name.toLowerCase(), parseBool(r['Aktiv'] ?? r['aktiv'] ?? r['Available'] ?? 'Bəli'));
    }
  }

  const byName = new Map(existingMenu.map(m => [m.name.trim().toLowerCase(), m]));
  // Canonical casing: "çay" in the file maps onto the existing "Çay" category
  const existingCatByLower = new Map(existingCategories.map(c => [c.name.trim().toLowerCase(), c.name]));
  const seenInFile = new Set<string>();
  const newItems: MenuItem[] = [];
  const updatedItems: MenuItem[] = [];
  const newCategories: Category[] = [];

  rows.forEach((row, idx) => {
    const rowNum = idx + 2; // 1-based + header row
    const mapped: Partial<Record<keyof typeof COL, unknown>> = {};
    for (const [rawKey, value] of Object.entries(row)) {
      const key = headerKey(rawKey);
      if (key) mapped[key] = value;
    }

    const name = String(mapped.name ?? '').trim();
    const rawCategory = String(mapped.category ?? '').trim();
    const category = existingCatByLower.get(rawCategory.toLowerCase())
      ?? newCategories.find(c => c.name.toLowerCase() === rawCategory.toLowerCase())?.name
      ?? rawCategory;
    if (!name && !category) return; // blank row
    if (!name) { errors.push(`Sətir ${rowNum}: məhsul adı boşdur`); return; }
    if (!category) { errors.push(`Sətir ${rowNum}: "${name}" üçün kateqoriya boşdur`); return; }

    const nameKey = name.toLowerCase();
    if (seenInFile.has(nameKey)) { errors.push(`Sətir ${rowNum}: "${name}" faylda təkrarlanır — yalnız ilk sətir istifadə olunur`); return; }
    seenInFile.add(nameKey);

    const variants = parseVariants(mapped.variants, rowNum, errors);
    let price = parsePrice(mapped.price);
    if (price === null && variants?.length) price = variants[0].price;
    if (price === null) { errors.push(`Sətir ${rowNum}: "${name}" üçün qiymət yanlışdır və ya boşdur`); return; }

    const cost = parsePrice(mapped.cost);
    const available = parseBool(mapped.available);

    if (!existingCatByLower.has(category.toLowerCase()) && !newCategories.some(c => c.name.toLowerCase() === category.toLowerCase())) {
      newCategories.push({ name: category, available: catAvailability.get(category.toLowerCase()) ?? true });
    }

    const existing = byName.get(nameKey);
    if (existing) {
      // Existing product: id, image and cooking station are preserved
      updatedItems.push({
        ...existing,
        category,
        price,
        available,
        costPrice: cost ?? undefined,
        variants,
      });
    } else {
      newItems.push({
        id: crypto.randomUUID(),
        name,
        category,
        price,
        available,
        costPrice: cost ?? undefined,
        variants,
      });
    }
  });

  return { newItems, updatedItems, newCategories, errors, totalRows: rows.length };
}

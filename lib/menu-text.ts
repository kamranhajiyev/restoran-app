import * as XLSX from 'xlsx';
import { COL } from './excel';

// A menu typed as plain text (from a photo, a PDF, a WhatsApp message) turned
// into the same file the admin import reads.
//
//   # Toyuq dönər | suffix=toyuq | kind=meal
//   Çörəkdə Dönər   2.20
//   Lavaşda Dönər   3.00 (1.10)                  ← cost in brackets
//   Limonad: Stəkan=5(1.2) | Qrafin=12           ← sizes instead of one price
//
// `#` starts a category. `suffix=` is added to every name under it, for two
// categories that share dish names: the import keeps one row per name.
// `kind=` is meal, product or set. Blank lines and lines starting with // are skipped.

export interface MenuTextResult {
  rows: Record<string, string | number>[];
  categories: string[];
  errors: string[]; // with the text's line numbers
}

const PRICE = /^(.+?)\s+(\d+(?:[.,]\d+)?)\s*(?:₼|azn)?(?:\s*\((\d+(?:[.,]\d+)?)\))?$/i;
const SIZES = /^(.+?)\s*:\s*(.+=.+)$/;
const KINDS: Record<string, string> = { meal: 'Yemək', yemək: 'Yemək', product: 'Məhsul', məhsul: 'Məhsul', set: 'Set' };

const num = (s: string) => Math.round(parseFloat(s.replace(',', '.')) * 100) / 100;

export function menuTextToRows(text: string): MenuTextResult {
  const errors: string[] = [];
  const categories: string[] = [];
  const items: { category: string; name: string; price: number | ''; cost: number | ''; kind: string; variants: string }[] = [];
  const firstLine = new Map<string, number>();
  let category = '', suffix = '', kind = '';

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    const at = `Line ${i + 1}`;
    if (!line || line.startsWith('//')) return;

    if (line.startsWith('#')) {
      const [name, ...opts] = line.slice(1).split('|').map(p => p.trim());
      if (!name) { errors.push(`${at}: category has no name`); return; }
      category = name; suffix = ''; kind = '';
      if (!categories.includes(name)) categories.push(name);
      for (const opt of opts) {
        const [key, value = ''] = opt.split('=').map(p => p.trim());
        if (key === 'suffix' && value) suffix = value;
        else if (key === 'kind' && KINDS[value.toLowerCase()]) kind = KINDS[value.toLowerCase()];
        else errors.push(`${at}: unknown option "${opt}" (use suffix=… or kind=meal / kind=product / kind=set)`);
      }
      return;
    }

    if (!category) { errors.push(`${at}: "${line}" comes before any # category`); return; }

    const sizes = line.match(SIZES);
    const priced = sizes ? null : line.match(PRICE);
    if (!sizes && !priced) { errors.push(`${at}: no price at the end of "${line}"`); return; }

    const bare = (sizes ? sizes[1] : priced![1]).trim();
    const name = suffix ? `${bare} (${suffix})` : bare;
    const seen = firstLine.get(name.toLowerCase());
    if (seen) {
      errors.push(`${at}: "${name}" is already on line ${seen} — the import keeps one row per name; give one category a suffix=`);
      return;
    }
    firstLine.set(name.toLowerCase(), i + 1);

    items.push({
      category, name, kind,
      price: priced ? num(priced[2]) : '',
      cost: priced?.[3] ? num(priced[3]) : '',
      variants: sizes ? sizes[2].trim() : '',
    });
  });

  // Only the columns the text really gave: on import an empty column clears that
  // field on a dish the restaurant already has (LESSONS.md, "clear it" or "not given").
  const has = { cost: items.some(m => m.cost !== ''), kind: items.some(m => m.kind), variants: items.some(m => m.variants) };
  const rows = items.map(m => ({
    [COL.category]: m.category,
    [COL.name]: m.name,
    [COL.price]: m.price,
    ...(has.cost ? { [COL.cost]: m.cost } : {}),
    ...(has.kind ? { [COL.kind]: m.kind } : {}),
    ...(has.variants ? { [COL.variants]: m.variants } : {}),
  }));
  return { rows, categories, errors };
}

export function menuTextWorkbook(result: MenuTextResult): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(result.rows);
  sheet['!cols'] = [{ wch: 18 }, { wch: 30 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, sheet, 'Menyu');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(result.categories.map(c => ({ 'Ad': c, 'Aktiv': 'Bəli' }))), 'Kateqoriyalar');
  return wb;
}

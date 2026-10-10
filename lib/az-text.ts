// Search that forgives the keyboard: "cay" finds "Çay", "dolmasi" finds
// "dolması". Every search box folds both sides with this before comparing.
const AZ_CHARS: Record<string, string> = { 'ç': 'c', 'ə': 'e', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u' };

export function azNormalize(s: string): string {
  return s.toLocaleLowerCase('az').replace(/[çəğıöşü]/g, ch => AZ_CHARS[ch]);
}

/** The rows whose name holds what was typed; all of them when nothing was. */
export function searchByName<T extends { name: string }>(rows: T[], query: string): T[] {
  const q = azNormalize(query.trim());
  return q ? rows.filter(r => azNormalize(r.name).includes(q)) : rows;
}

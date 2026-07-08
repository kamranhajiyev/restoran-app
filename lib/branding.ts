// Per-company brand accent. Presets only — guarantees readable, on-brand color.
// The scales themselves live in app/globals.css keyed by [data-brand].

export const BRAND_PRESETS = [
  { key: 'teal',       label: 'Teal',       swatch: '#0f766e' },
  { key: 'indigo',     label: 'İndiqo',     swatch: '#4338ca' },
  { key: 'terracotta', label: 'Terrakota',  swatch: '#b45309' },
  { key: 'emerald',    label: 'Yaşıl',      swatch: '#047857' },
  { key: 'rose',       label: 'Çəhrayı',    swatch: '#be123c' },
  { key: 'black',      label: 'Qara',       swatch: '#1c1c1c' },
] as const;

export type BrandColor = (typeof BRAND_PRESETS)[number]['key'];

export const DEFAULT_BRAND: BrandColor = 'teal';

export function isBrandColor(v: unknown): v is BrandColor {
  return typeof v === 'string' && BRAND_PRESETS.some(p => p.key === v);
}

// Apply a brand to the whole document. Falls back to the default preset.
export function applyBrand(color: string | null | undefined): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.brand = isBrandColor(color) ? color : DEFAULT_BRAND;
}

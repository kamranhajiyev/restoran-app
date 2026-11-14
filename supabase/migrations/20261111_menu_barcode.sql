-- Barcodes (SHOP-MODE.md, lib/barcode.ts). A product's own barcode lives here;
-- each size keeps its own inside menu_items.variants (no column needed).
-- Text, not a number: barcodes can hold letters and leading zeros.
alter table public.menu_items add column if not exists barcode text;

-- The till looks a scan up within one company.
create index if not exists menu_items_company_barcode_idx
  on public.menu_items (company_id, barcode) where barcode is not null;

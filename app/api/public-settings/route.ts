// The switches an owner flips, for a terminal that has no session.
//
// Kassa, tables, receipt printing, sound and branding all live on the companies
// row, and every reader of them queried that table directly. RLS refuses a
// terminal link on every one of those reads, and each helper answers its own
// failure with a safe-looking default — true. So an owner who turned Kassa off
// in the admin panel watched the till go on showing it, with no error anywhere:
// the till was not disobeying, it was never told.
//
// One route, one row, all of the flags, so the desktop till can also keep them
// on the machine and honour them during an outage.

import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get('companyId');
  if (!companyId) return Response.json({ error: 'companyId required' }, { status: 400 });

  const db = createServerClient();
  const { data, error } = await db
    .from('companies')
    .select('tables_enabled, kassa_enabled, print_receipt, sound_enabled, menu_only, logo_url, brand_color')
    .eq('id', companyId)
    .single();

  if (error || !data) return Response.json({ error: 'not found' }, { status: 404 });

  // Explicit booleans rather than the row as it stands: a null column means "not
  // set", which everywhere in the app has always meant on, and the till should
  // not have to know that.
  return Response.json({
    settings: {
      tablesEnabled: data.tables_enabled !== false,
      kassaEnabled: data.kassa_enabled !== false,
      printReceipt: data.print_receipt !== false,
      soundEnabled: data.sound_enabled !== false,
      menuOnly: data.menu_only === true,
      logoUrl: data.logo_url ?? null,
      brandColor: data.brand_color ?? null,
    },
  });
}

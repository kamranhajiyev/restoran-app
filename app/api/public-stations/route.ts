import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

// The tokenless terminal has no auth session, so RLS would hand it nothing. It needs
// the sex list to work out which sex prepares each line — the same reason it fetches
// the menu through /api/public-menu.
//
// position, then created_at: the same order the print_jobs triggers use to pick the
// fallback "first sex". A different order here would colour a line for the wrong sex.
export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get('companyId');
  if (!companyId) return Response.json({ stations: [] }, { status: 400 });

  const db = createServerClient();
  const { data, error } = await db
    .from('stations')
    .select('id, name, printer_ip, printer_port')
    .eq('company_id', companyId)
    .order('position')
    .order('created_at');

  if (error) return Response.json({ stations: [] }, { status: 500 });

  return Response.json({
    stations: (data ?? []).map(r => ({
      id: r.id,
      name: r.name,
      printerIp: r.printer_ip ?? null,
      printerPort: r.printer_port ?? 9100,
    })),
  });
}

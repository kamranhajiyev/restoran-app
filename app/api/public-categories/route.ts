import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get('companyId');
  if (!companyId) return Response.json({ categories: [] }, { status: 400 });

  const db = createServerClient();
  const { data, error } = await db
    .from('categories')
    .select('name, available, qr_visible, position')
    .eq('company_id', companyId)
    .order('position');

  if (error) return Response.json({ categories: [] }, { status: 500 });

  return Response.json({ categories: data ?? [] });
}

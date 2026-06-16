import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get('companyId');
  if (!companyId) return Response.json({ tables: [] }, { status: 400 });

  const db = createServerClient();
  const { data, error } = await db
    .from('restaurant_tables')
    .select('id, name, capacity, x, y, w, h, shape')
    .eq('company_id', companyId)
    .order('id');

  if (error) return Response.json({ tables: [] }, { status: 500 });

  return Response.json({ tables: data ?? [] });
}

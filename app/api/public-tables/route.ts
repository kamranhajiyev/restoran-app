import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get('companyId');
  if (!companyId) return Response.json({ tables: [], halls: [] }, { status: 400 });

  const db = createServerClient();
  const [tableRes, hallRes] = await Promise.all([
    db.from('restaurant_tables')
      .select('id, name, capacity, x, y, w, h, shape, hall_id')
      .eq('company_id', companyId)
      .order('id'),
    db.from('halls')
      .select('id, name, position')
      .eq('company_id', companyId)
      .order('position')
      .order('name'),
  ]);

  if (tableRes.error) return Response.json({ tables: [], halls: [] }, { status: 500 });

  return Response.json({ tables: tableRes.data ?? [], halls: hallRes.data ?? [] });
}

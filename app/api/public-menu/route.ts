import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get('companyId');
  if (!companyId) return Response.json({ items: [] }, { status: 400 });

  const db = createServerClient();
  const { data, error } = await db
    .from('menu_items')
    .select('id, name, price, category, available, variants, cost_price, image, cooking_station, position')
    .eq('company_id', companyId)
    .order('position');

  if (error) return Response.json({ items: [] }, { status: 500 });

  const items = (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id,
    name: r.name,
    price: Number(r.price),
    category: r.category,
    available: r.available,
    variants: r.variants ?? undefined,
    costPrice: r.cost_price ? Number(r.cost_price) : undefined,
    image: r.image ?? undefined,
    cookingStation: r.cooking_station ?? undefined,
  }));

  return Response.json({ items });
}

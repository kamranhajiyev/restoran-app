import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get('companyId');
  if (!companyId) return Response.json({ items: [] }, { status: 400 });

  const db = createServerClient();
  const { data, error } = await db
    .from('menu_items')
    .select('id, name, price, category, available, variants, cost_price, image, station_id, position')
    .eq('company_id', companyId)
    .order('position');

  if (error) return Response.json({ items: [] }, { status: 500 });

  // Which reusable modifier sets each item offers. Scoped through the group's
  // company_id so one company can never see another's links.
  const { data: links } = await db
    .from('menu_item_modifier_groups')
    .select('menu_item_id, group_id, modifier_groups!inner(company_id)')
    .eq('modifier_groups.company_id', companyId)
    .order('position');
  const byItem = new Map<string, string[]>();
  for (const l of links ?? []) {
    const bucket = byItem.get(l.menu_item_id);
    if (bucket) bucket.push(l.group_id); else byItem.set(l.menu_item_id, [l.group_id]);
  }

  const items = (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id,
    name: r.name,
    price: Number(r.price),
    category: r.category,
    available: r.available,
    variants: r.variants ?? undefined,
    costPrice: r.cost_price ? Number(r.cost_price) : undefined,
    image: r.image ?? undefined,
    stationId: r.station_id ?? null,
    modifierGroupIds: byItem.get(r.id as string) ?? [],
  }));

  return Response.json({ items });
}

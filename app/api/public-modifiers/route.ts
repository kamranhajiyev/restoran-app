import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import type { ModifierGroup, ModifierOption } from '@/types';

// The seller terminal runs unauthenticated off a company token, so it reads the
// menu through /api/public-menu rather than RLS. Its modifier sets have to come
// the same way, or a terminal seller would see no options at all.
export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get('companyId');
  if (!companyId) return Response.json({ groups: [] }, { status: 400 });

  const db = createServerClient();
  const { data: groups, error } = await db
    .from('modifier_groups')
    .select('id, name, min_select, max_select, position')
    .eq('company_id', companyId)
    .order('position');
  if (error) return Response.json({ groups: [] }, { status: 500 });

  const ids = (groups ?? []).map(g => g.id);
  const { data: options } = ids.length
    ? await db.from('modifier_options')
        .select('id, group_id, name, price, image, position')
        .in('group_id', ids)
        .order('position')
    : { data: [] };

  const byGroup = new Map<string, ModifierOption[]>();
  for (const o of options ?? []) {
    const opt: ModifierOption = {
      id: o.id,
      name: o.name,
      price: Number(o.price),
      image: o.image ?? undefined,
      position: o.position,
    };
    const bucket = byGroup.get(o.group_id);
    if (bucket) bucket.push(opt); else byGroup.set(o.group_id, [opt]);
  }

  const result: ModifierGroup[] = (groups ?? []).map(g => ({
    id: g.id,
    name: g.name,
    minSelect: g.min_select,
    maxSelect: g.max_select ?? null,
    position: g.position,
    options: byGroup.get(g.id) ?? [],
  }));

  return Response.json({ groups: result });
}

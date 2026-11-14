// Az qalan mal for a till with no session (SHOP-MODE.md, lib/low-stock.ts):
// which products, or sizes, are below the owner's limit, and how many are
// left — nothing else about the stock. Checked like every /api/public-* read.

import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { refuseTillRead } from '@/lib/till-read-auth';
import { lowForTill, lowStock } from '@/lib/low-stock';

export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get('companyId');
  if (!companyId) return Response.json({ error: 'companyId required' }, { status: 400 });
  const refused = await refuseTillRead(req, companyId);
  if (refused) return refused;

  const db = createServerClient();
  // A database without the limit column answers with no warnings.
  const { data: limits, error } = await db.from('stock_items')
    .select('id, min_qty').eq('company_id', companyId).not('min_qty', 'is', null);
  if (error || !limits || limits.length === 0) return Response.json({ low: {} });

  const [{ data: bal, error: e1 }, { data: links, error: e2 }] = await Promise.all([
    db.from('stock_balances').select('stock_item_id, qty').eq('company_id', companyId),
    db.from('recipe_lines').select('menu_item_id, variant_id, stock_item_id').eq('company_id', companyId),
  ]);
  if (e1 || e2) return Response.json({ error: 'read failed' }, { status: 500 });

  const low = lowStock(
    limits.map(l => ({ stockItemId: l.id as string, minQty: Number(l.min_qty) })),
    (bal ?? []).map(b => ({ stockItemId: b.stock_item_id as string, qty: Number(b.qty) })),
  );
  return Response.json({
    low: lowForTill(low, (links ?? []).map(l => ({ menuItemId: l.menu_item_id as string, variantId: (l.variant_id as string | null) ?? null, stockItemId: l.stock_item_id as string }))),
  });
}

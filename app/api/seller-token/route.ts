import { NextRequest } from 'next/server';
import { createServerClient, requireAuth } from '@/lib/supabase-server';

// Public: validate slug + token → return company context
export async function GET(req: NextRequest) {
  const slug  = req.nextUrl.searchParams.get('slug');
  const token = req.nextUrl.searchParams.get('token');
  if (!slug || !token) return Response.json({ error: 'invalid' }, { status: 400 });

  const db = createServerClient();
  const { data } = await db
    .from('companies')
    .select('id, name')
    .eq('slug', slug)
    .eq('seller_token', token)
    .eq('active', true)
    .is('trashed_at', null)
    .maybeSingle();

  if (!data) return Response.json({ error: 'invalid' }, { status: 404 });
  return Response.json({ companyId: data.id, companyName: data.name });
}

// Owner only: regenerate this company's seller token
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'owner') return Response.json({ error: 'Forbidden' }, { status: 403 });
  if (!auth.companyId) return Response.json({ error: 'No company' }, { status: 400 });

  const db = createServerClient();
  const newToken = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');

  const { error } = await db
    .from('companies')
    .update({ seller_token: newToken })
    .eq('id', auth.companyId);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ token: newToken });
}

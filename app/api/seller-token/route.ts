import { NextRequest } from 'next/server';
import { createServerClient, requireAuth } from '@/lib/supabase-server';
import { settingsFromRow, tillLocked } from '@/lib/subscription';

// Public: validate slug + token → return company context
export async function GET(req: NextRequest) {
  const slug  = req.nextUrl.searchParams.get('slug');
  const token = req.nextUrl.searchParams.get('token');
  // No slug and no token: a signed-in user asking for their own company's link.
  // The column is closed to the browser (20261008_hide_seller_token.sql), so
  // admin gets it here.
  if (!slug && !token) return ownToken(req);
  if (!slug || !token) return Response.json({ error: 'invalid' }, { status: 400 });

  const db = createServerClient();
  const { data } = await db
    .from('companies')
    .select('id, name, logo_url, brand_color, expires_at, active, timezone, work_open, work_close')
    .eq('slug', slug)
    .eq('seller_token', token)
    .is('trashed_at', null)
    .maybeSingle();

  // All three refusals are 404, so tills built before the reasons existed still
  // stop on each. Newer ones read `error` to say which (lib/subscription.ts).
  // Only someone holding the right token learns the reason.
  if (!data) return Response.json({ error: 'invalid' }, { status: 404 });
  if (!data.active) return Response.json({ error: 'inactive' }, { status: 404 });
  if (tillLocked(data.expires_at, settingsFromRow(data))) return Response.json({ error: 'expired' }, { status: 404 });
  // expiresAt rides along so the terminal can show the same subscription banner a
  // logged-in seller gets. It has no session to read it from.
  return Response.json({ companyId: data.id, companyName: data.name, logoUrl: data.logo_url ?? null, brandColor: data.brand_color ?? null, expiresAt: data.expires_at ?? null });
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

async function ownToken(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (!auth.companyId) return Response.json({ token: null });
  const { data } = await createServerClient()
    .from('companies').select('seller_token').eq('id', auth.companyId).maybeSingle();
  return Response.json({ token: data?.seller_token ?? null });
}

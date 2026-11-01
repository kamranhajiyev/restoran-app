import { NextRequest } from 'next/server';
import { createServerClient, requireSuperadmin } from '@/lib/supabase-server';
import { mintViewAs } from '@/lib/view-as';

// Superadmin only: a one-time login code for a restaurant's owner (lib/view-as).
export async function POST(req: NextRequest) {
  const auth = await requireSuperadmin(req);
  if (auth instanceof Response) return auth;

  const { companyId } = await req.json().catch(() => ({}));
  const fwd = req.headers.get('x-forwarded-for');
  const r = await mintViewAs(createServerClient(), auth.id, String(companyId ?? ''), {
    ip: fwd ? fwd.split(',')[0].trim() : req.headers.get('x-real-ip'),
    userAgent: req.headers.get('user-agent'),
  });

  if ('error' in r) return Response.json({ error: r.error }, { status: r.status });
  return Response.json(r);
}

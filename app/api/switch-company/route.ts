import { NextRequest } from 'next/server';
import { createServerClient, requireAuth } from '@/lib/supabase-server';
import { mintSwitch, venuesFor } from '@/lib/switch-company';

// The main company's owner: which məkans they can open (lib/switch-company).
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const r = await venuesFor(createServerClient(), auth.id);
  if ('error' in r) return Response.json({ error: r.error }, { status: r.status });
  return Response.json(r);
}

// A one-time login code for one of them.
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { companyId } = await req.json().catch(() => ({}));
  const r = await mintSwitch(createServerClient(), auth.id, String(companyId ?? ''));
  if ('error' in r) return Response.json({ error: r.error }, { status: r.status });
  return Response.json(r);
}

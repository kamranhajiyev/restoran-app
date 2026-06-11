import { NextRequest } from 'next/server';
import { createServerClient, requireAuth } from '@/lib/supabase-server';

// The client can't know its own public IP and anything it reports about itself
// can be faked, so the event is recorded here from the request headers.
function clientIp(req: NextRequest): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip');
}

// Any authenticated user records their own login.
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const db = createServerClient();
  const { error } = await db.from('login_events').insert({
    user_id: auth.id,
    company_id: auth.companyId,
    ip: clientIp(req),
    user_agent: req.headers.get('user-agent'),
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

// Owners see logins of their own company; superadmin sees everything.
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'superadmin' && auth.role !== 'owner') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = createServerClient();
  let q = db
    .from('login_events')
    .select('id, ip, user_agent, created_at, profiles(name, username, role)')
    .order('created_at', { ascending: false })
    .limit(200);

  if (auth.role === 'owner') {
    if (!auth.companyId) return Response.json([]);
    q = q.eq('company_id', auth.companyId);
  }

  const { data, error } = await q;
  if (error) return Response.json([]);
  return Response.json(data ?? []);
}

import { NextRequest } from 'next/server';
import { createServerClient, requireAuth, verifySellerToken } from '@/lib/supabase-server';

// Store a browser's push subscription so the "order ready" alert can reach it while
// backgrounded (see app/api/notify-ready). Trusts the company from the auth bearer, or
// from the seller token on the tokenless terminal — never the client-supplied id alone.
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.subscription?.endpoint) {
    return Response.json({ error: 'Bad request' }, { status: 400 });
  }

  // Resolve the company from a trusted source, not from body.companyId directly.
  let companyId: string | null = null;
  if (req.headers.get('authorization')) {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;
    companyId = auth.companyId;
  } else if (body.companyId && body.token) {
    companyId = await verifySellerToken(body.companyId, body.token);
  }
  if (!companyId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createServerClient();
  const { error } = await db
    .from('push_subscriptions')
    .upsert(
      {
        company_id: companyId,
        device_id: body.deviceId ?? null,
        role: 'seller',
        endpoint: body.subscription.endpoint,
        subscription: body.subscription,
      },
      { onConflict: 'endpoint' },
    );

  if (error) {
    console.error('[push-subscribe]', error);
    return Response.json({ error: 'Save failed' }, { status: 500 });
  }
  return Response.json({ ok: true });
}

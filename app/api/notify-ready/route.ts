import { NextRequest } from 'next/server';
import webpush from 'web-push';
import { createServerClient, requireAuth } from '@/lib/supabase-server';

// Send the "order ready" push to every waiter device of the caller's company. Fired by
// the sex screen right after it marks an order ready (app/station/page.tsx). The company
// is taken from the caller's auth, never the client, so one venue cannot buzz another.
export const runtime = 'nodejs';

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:admin@restoran.app';
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

export async function POST(req: NextRequest) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return Response.json({ error: 'Push not configured' }, { status: 500 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const companyId = auth.companyId;
  if (!companyId) return Response.json({ error: 'No company' }, { status: 400 });

  const body = await req.json().catch(() => ({}));

  const db = createServerClient();
  const { data: subs, error } = await db
    .from('push_subscriptions')
    .select('endpoint, subscription')
    .eq('company_id', companyId)
    .eq('role', 'seller');

  if (error) {
    console.error('[notify-ready]', error);
    return Response.json({ error: 'Lookup failed' }, { status: 500 });
  }
  if (!subs?.length) return Response.json({ ok: true, sent: 0 });

  const payload = JSON.stringify({
    title: body.title || 'Sifariş hazırdır',
    body: body.body || 'Bir sex sifarişi hazır etdi',
    tag: body.orderId ? `ready-${body.orderId}` : 'order-ready',
    url: '/seller',
  });

  // Prune dead endpoints (404/410) as we go: a browser that unsubscribed or was wiped
  // otherwise leaves a row that fails on every future order forever.
  const stale: string[] = [];
  const results = await Promise.allSettled(
    subs.map(s =>
      webpush.sendNotification(s.subscription as webpush.PushSubscription, payload)
        .catch((err: { statusCode?: number }) => {
          if (err?.statusCode === 404 || err?.statusCode === 410) stale.push(s.endpoint);
          else console.error('[notify-ready] send', err?.statusCode, s.endpoint);
          throw err;
        }),
    ),
  );

  if (stale.length) {
    await db.from('push_subscriptions').delete().in('endpoint', stale);
  }

  const sent = results.filter(r => r.status === 'fulfilled').length;
  return Response.json({ ok: true, sent });
}

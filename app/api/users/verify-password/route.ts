import { createServerClient, requireAuth } from '@/lib/supabase-server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  const caller = await requireAuth(req);
  if (caller instanceof Response) return caller;

  const { id, password } = await req.json();

  // Users can only verify their own password
  if (caller.id !== id) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const db = createServerClient();
  const { data: profile } = await db.from('profiles').select('username').eq('id', id).single();
  if (!profile) return Response.json({ valid: false });

  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const { error } = await anonClient.auth.signInWithPassword({
    email: `${profile.username}@restoran.internal`,
    password,
  });

  return Response.json({ valid: !error });
}

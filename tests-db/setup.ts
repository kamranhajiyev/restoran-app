// The test restaurants and logins the database tests sign in as, on "restoran
// testing" only. Two restaurants so a test can check one never reaches the
// other; each run makes them if missing and gives every login a new password.

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { notTestingReason } from '@/lib/testing-db';

const stop = notTestingReason(process.env.NEXT_PUBLIC_SUPABASE_URL);
if (stop) throw new Error(`Database tests stopped: ${stop}`);

const { createClient } = await import('@supabase/supabase-js');
type Client = SupabaseClient;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!anonKey || !serviceKey) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are needed (.env.local)');

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

/** Sees and changes everything: only for making and cleaning up test data, never for the check itself. */
export const admin: Client = createClient(url, serviceKey, noSession);

/** The public key with no login: what anyone on the internet has. */
export const anon: Client = createClient(url, anonKey, noSession);

export type TestCompany = { id: string; slug: string };

async function ensureCompany(slug: string): Promise<TestCompany> {
  const { data, error } = await admin.from('companies').select('id').eq('slug', slug).maybeSingle();
  if (error) throw new Error(`company ${slug}: ${error.message}`);
  if (data) return { id: data.id, slug };
  const made = await admin.from('companies').insert({ slug, name: `Autotest ${slug}` }).select('id').single();
  if (made.error) throw new Error(`company ${slug}: ${made.error.message}`);
  return { id: made.data.id, slug };
}

/** A logged-in client for this username, made with a fresh password each run. */
async function login(username: string, role: 'owner' | 'seller', company: TestCompany): Promise<Client> {
  const email = `${username}@restoran.internal`;
  const password = randomUUID();
  const { data: profile, error } = await admin.from('profiles').select('id, company_id, role').eq('username', username).maybeSingle();
  if (error) throw new Error(`profile ${username}: ${error.message}`);
  if (profile && (profile.company_id !== company.id || profile.role !== role)) {
    throw new Error(`${username} exists but is not the ${role} of ${company.slug}: left alone`);
  }

  if (profile) {
    const upd = await admin.auth.admin.updateUserById(profile.id, { password });
    if (upd.error) throw new Error(`password ${username}: ${upd.error.message}`);
  } else {
    const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (made.error || !made.data.user) throw new Error(`login ${username}: ${made.error?.message}`);
    const p = await admin.from('profiles').insert({
      id: made.data.user.id, username, name: username, role, company_id: company.id, station_id: null,
    });
    if (p.error) {
      await admin.auth.admin.deleteUser(made.data.user.id);
      throw new Error(`profile ${username}: ${p.error.message}`);
    }
  }

  const client = createClient(url, anonKey, noSession);
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`sign in ${username}: ${signIn.error.message}`);
  return client;
}

// The owner watches this one in the admin page; what a test keeps shows up there.
export const companyA = await ensureCompany('kamran-test-ucun');
export const companyB = await ensureCompany('autotest-b');
export const ownerA = await login('autotest-owner', 'owner', companyA);
export const sellerA = await login('autotest-seller', 'seller', companyA);
export const ownerB = await login('autotest-b-owner', 'owner', companyB);

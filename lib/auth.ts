import { supabase } from './supabase';
import { Role } from '@/types';

const AUTH_KEY = 'restoran_auth';

export interface Session {
  id: string;
  name: string;
  role: Role;
  companyId: string | null;
  companyName: string | null;
  expiresAt: string | null;
}

export type LoginResult = { session: Session } | { error: 'invalid' | 'inactive' };

export async function login(username: string, password: string): Promise<LoginResult> {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: `${username.trim()}@restoran.internal`,
      password,
    });

    if (error || !data.user) return { error: 'invalid' };

    const { data: profile } = await supabase
      .from('profiles')
      .select('name, role, company_id, active')
      .eq('id', data.user.id)
      .single();

    if (!profile) return { error: 'invalid' };
    if (!profile.active) return { error: 'inactive' };

    let companyName: string | null = null;
    let expiresAt: string | null = null;

    if (profile.company_id) {
      const { data: co } = await supabase
        .from('companies')
        .select('name, expires_at, active')
        .eq('id', profile.company_id)
        .single();
      if (!co || !co.active) return { error: 'inactive' };
      companyName = co.name ?? null;
      expiresAt = co.expires_at ?? null;
    }

    const session: Session = {
      id: data.user.id,
      name: profile.name,
      role: profile.role as Role,
      companyId: profile.company_id ?? null,
      companyName,
      expiresAt,
    };

    localStorage.setItem(AUTH_KEY, JSON.stringify(session));
    return { session };
  } catch {
    return { error: 'invalid' };
  }
}

export function getSession(): Session | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(AUTH_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function logout() {
  supabase.auth.signOut();
  localStorage.removeItem(AUTH_KEY);
}

export async function validateSession(session: Session): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return false;

    const { data: profile } = await supabase
      .from('profiles')
      .select('active')
      .eq('id', session.id)
      .single();
    if (!profile?.active) return false;

    if (session.companyId) {
      const { data: co } = await supabase
        .from('companies')
        .select('active, expires_at')
        .eq('id', session.companyId)
        .single();
      if (!co?.active) return false;
      if (co.expires_at && new Date(co.expires_at) < new Date()) return false;
    }

    return true;
  } catch {
    return false;
  }
}

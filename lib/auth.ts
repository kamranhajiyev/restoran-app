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
    const { data: user } = await supabase
      .from('users')
      .select('id, name, role, company_id, active')
      .eq('username', username.trim())
      .eq('password', password)
      .single();
    if (!user) return { error: 'invalid' };
    if (!user.active) return { error: 'inactive' };
    let companyName: string | null = null;
    let expiresAt: string | null = null;
    if (user.company_id) {
      const { data: co } = await supabase.from('companies').select('name, expires_at, active').eq('id', user.company_id).single();
      if (!co || !co.active) return { error: 'inactive' };
      companyName = co.name ?? null;
      expiresAt = co.expires_at ?? null;
    }
    const session: Session = {
      id: user.id,
      name: user.name,
      role: user.role as Role,
      companyId: user.company_id ?? null,
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
  localStorage.removeItem(AUTH_KEY);
}

export async function validateSession(session: Session): Promise<boolean> {
  try {
    const { data: user } = await supabase.from('users').select('active').eq('id', session.id).single();
    if (!user?.active) return false;
    if (session.companyId) {
      const { data: co } = await supabase.from('companies').select('active').eq('id', session.companyId).single();
      if (!co?.active) return false;
    }
    return true;
  } catch {
    return false;
  }
}

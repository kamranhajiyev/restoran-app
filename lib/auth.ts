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

export async function login(username: string, password: string): Promise<Session | null> {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, name, role, company_id')
      .eq('username', username.trim())
      .eq('password', password)
      .eq('active', true)
      .single();
    if (error || !data) return null;
    let companyName: string | null = null;
    let expiresAt: string | null = null;
    if (data.company_id) {
      const { data: co } = await supabase.from('companies').select('name, expires_at').eq('id', data.company_id).single();
      companyName = co?.name ?? null;
      expiresAt = co?.expires_at ?? null;
    }
    const session: Session = {
      id: data.id,
      name: data.name,
      role: data.role as Role,
      companyId: data.company_id ?? null,
      companyName,
      expiresAt,
    };
    localStorage.setItem(AUTH_KEY, JSON.stringify(session));
    return session;
  } catch {
    return null;
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

export interface LoginEvent {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  name: string;
  username: string;
  role: string;
}

/** A row of /api/login-events as Girişlər shows it. The login keeps the name it
 *  was made under, so a person deleted since is still named; an old row
 *  without one falls back to the profile. */
export function loginEventFromRow(e: Record<string, unknown>): LoginEvent {
  const p = (e.profiles ?? {}) as Record<string, unknown>;
  return {
    id: e.id as string,
    ip: (e.ip as string | null) ?? null,
    userAgent: (e.user_agent as string | null) ?? null,
    createdAt: e.created_at as string,
    name: (e.name ?? p.name ?? '—') as string,
    username: (e.username ?? p.username ?? '') as string,
    role: (e.role ?? p.role ?? '') as string,
  };
}

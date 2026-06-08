import { Role } from '@/types';

const AUTH_KEY = 'restoran_auth';

const USERS: { username: string; password: string; role: Role; name: string }[] = [
  { username: 'admin', password: 'admin123', role: 'admin', name: 'Admin' },
  { username: 'ofisiant', password: '1234', role: 'waiter', name: 'Ofisiant' },
];

export function login(username: string, password: string) {
  const user = USERS.find(u => u.username === username && u.password === password);
  if (!user) return null;
  const session = { role: user.role, name: user.name };
  localStorage.setItem(AUTH_KEY, JSON.stringify(session));
  return session;
}

export function getSession(): { role: Role; name: string } | null {
  if (typeof window === 'undefined') return null;
  const data = localStorage.getItem(AUTH_KEY);
  return data ? JSON.parse(data) : null;
}

export function logout() {
  localStorage.removeItem(AUTH_KEY);
}

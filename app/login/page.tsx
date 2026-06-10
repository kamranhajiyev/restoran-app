'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { login } from '@/lib/auth';
import { Store } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const result = await login(username, password);
    setLoading(false);
    if ('error' in result) {
      setError(result.error === 'inactive'
        ? 'Hesabınız deaktiv edilib. Zəhmət olmasa əlaqə saxlayın.'
        : 'İstifadəçi adı və ya şifrə yanlışdır');
      return;
    }
    const { session } = result;
    if (session.role === 'superadmin') router.push('/superadmin');
    else if (session.role === 'owner')  router.push('/admin');
    else                                router.push('/seller');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-lg p-10 w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-gray-900 flex items-center justify-center mx-auto mb-3">
            <Store className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">Sistemə daxil olun</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">İstifadəçi adı</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
              autoFocus
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Şifrə</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
              required
            />
          </div>

          {error && (
            error.includes('deaktiv') ? (
              <p className="text-red-500 text-sm text-center">
                Hesabınız deaktiv edilib.{' '}
                <a
                  href="https://wa.me/994998989876"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline font-semibold hover:text-red-700"
                >
                  Əlaqə saxlayın
                </a>
              </p>
            ) : (
              <p className="text-red-500 text-sm text-center">{error}</p>
            )
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gray-900 hover:bg-gray-800 disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl transition-colors"
          >
            {loading ? 'Yüklənir...' : 'Daxil ol'}
          </button>
        </form>
      </div>
    </div>
  );
}

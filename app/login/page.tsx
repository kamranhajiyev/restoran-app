'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { login, homeFor } from '@/lib/auth';
import { Store } from 'lucide-react';
import { SUPPORT_URL } from '@/lib/subscription';

const EXPIRED = 'Abunəliyinizin müddəti bitib.';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  // A page that threw someone out over the date says so (lib/auth loginAfterCheck),
  // instead of leaving a bare login form that reads as a wrong password.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('r') === 'expired') setError(EXPIRED);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const result = await login(username, password);
    setLoading(false);
    if ('error' in result) {
      setError(result.error === 'inactive'
        ? 'Hesabınız deaktiv edilib. Zəhmət olmasa əlaqə saxlayın.'
        : result.error === 'expired'
          ? EXPIRED
          : 'İstifadəçi adı və ya şifrə yanlışdır');
      return;
    }
    const { session } = result;
    router.push(homeFor(session));
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
            error === EXPIRED ? (
              <p className="text-red-500 text-sm text-center">
                {EXPIRED}{' '}
                <a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer" className="underline font-semibold hover:text-red-700">
                  Ödəniş üçün əlaqə saxlayın
                </a>
              </p>
            ) : error.includes('deaktiv') ? (
              <p className="text-red-500 text-sm text-center">
                Hesabınız deaktiv edilib.{' '}
                <a
                  href={SUPPORT_URL}
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

'use client';

// An employee whose sex was deleted. profiles.station_id is ON DELETE SET NULL, so
// they are still a valid account with nothing to prepare. The prep screen would just
// be blank, which reads as "broken app" — say what actually happened instead.

import { useRouter } from 'next/navigation';
import { logout } from '@/lib/auth';

export default function NoStationPage() {
  const router = useRouter();
  return (
    <div className="min-h-screen grid place-items-center bg-gray-900 text-white p-6">
      <div className="text-center max-w-sm">
        <p className="text-5xl mb-4">🍳</p>
        <h1 className="text-xl font-bold mb-2">Sex təyin edilməyib</h1>
        <p className="text-gray-400 text-sm mb-6">
          Hesabınız heç bir sexə bağlı deyil, ona görə hazırlanacaq yemək göstərilmir.
          Rəhbərinizə müraciət edin.
        </p>
        <button
          onClick={() => { logout(); router.replace('/login'); }}
          className="px-5 py-3 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm font-semibold"
        >
          Çıxış
        </button>
      </div>
    </div>
  );
}

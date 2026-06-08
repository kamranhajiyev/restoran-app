'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSession } from '@/lib/auth';

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    const session = getSession();
    if (!session) {
      router.replace('/login');
    } else if (session.role === 'admin') {
      router.replace('/admin');
    } else {
      router.replace('/seller');
    }
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <p className="text-gray-500">Yüklənir...</p>
    </div>
  );
}

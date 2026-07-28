'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSession, homeFor } from '@/lib/auth';

// Sends an already-logged-in visitor to their own panel.
//
// This renders nothing on purpose. The landing page used to hold the session check
// itself and return a "Yüklənir..." spinner until it resolved — which meant the first
// HTML a crawler received contained no marketing copy at all. Keeping the redirect in
// a null-rendering client component lets the page stay a server component whose content
// is in the HTML unconditionally, while a logged-in user still lands where they belong.
export default function SessionRedirect() {
  const router = useRouter();

  useEffect(() => {
    const session = getSession();
    if (session) router.replace(homeFor(session));
  }, [router]);

  return null;
}

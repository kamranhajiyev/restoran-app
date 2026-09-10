'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSession, homeFor, tillHome } from '@/lib/auth';

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
    if (!session) return;
    // A terminal left on the till reopens on the till. The desktop shell always
    // launches at the site root, so without this an owner-signed machine walks
    // back into /admin every morning and meets the lock's password box — when
    // the person standing there is a waiter who only ever needed the PIN pad.
    router.replace(tillHome() ?? homeFor(session));
  }, [router]);

  return null;
}

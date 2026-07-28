import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

// Only the marketing pages are crawlable. Everything else is either a panel behind
// a login, a per-company URL that would leak a customer's menu into search results,
// or an API route.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/admin',
        '/seller',
        '/station',
        '/superadmin',
        '/waiter',
        '/no-station',
        '/login',
        '/s/',
        '/api/',
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}

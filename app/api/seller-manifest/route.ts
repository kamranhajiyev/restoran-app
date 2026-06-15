import { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug') ?? '';
  const token = req.nextUrl.searchParams.get('token') ?? '';
  const startUrl = `/s/${encodeURIComponent(slug)}/${encodeURIComponent(token)}`;

  const manifest = {
    name: 'possiblle',
    short_name: 'possiblle',
    description: 'Restoran idarəetmə sistemi',
    start_url: startUrl,
    scope: '/s/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#92400e',
    icons: [
      { src: '/icon.png', sizes: '512x512', type: 'image/png' },
      { src: '/apple-icon.png', sizes: '192x192', type: 'image/png' },
    ],
  };

  return new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/manifest+json' },
  });
}

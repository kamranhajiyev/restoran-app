import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'possiblle',
    short_name: 'possiblle',
    description: 'Restoran idarəetmə sistemi',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#92400e',
    icons: [
      { src: '/icon.png',       sizes: '512x512', type: 'image/png' },
      { src: '/apple-icon.png', sizes: '192x192', type: 'image/png' },
    ],
  };
}

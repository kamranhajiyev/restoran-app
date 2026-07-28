import type { Metadata, Viewport } from 'next';
import { Quicksand } from 'next/font/google';
import { SITE_URL } from '@/lib/site';
import './globals.css';

const quicksand = Quicksand({
  variable: '--font-quicksand',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

const DESCRIPTION =
  'QR menyu, sifariş qəbulu, mətbəx ekranı, kassa və növbə nəzarəti, anbar və mənfəət hesabatları — restoranınız üçün bir platformada.';

export const metadata: Metadata = {
  // Every canonical and openGraph URL below is written relative to this.
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'possiblle — Restoran idarəetmə sistemi',
    template: '%s | possiblle',
  },
  description: DESCRIPTION,
  applicationName: 'possiblle',
  openGraph: {
    type: 'website',
    siteName: 'possiblle',
    locale: 'az_AZ',
    url: '/',
    title: 'possiblle — Restoran idarəetmə sistemi',
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="az">
      <body className={`${quicksand.variable} font-sans antialiased min-h-screen bg-gray-50`}>
        {children}
      </body>
    </html>
  );
}

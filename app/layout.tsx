import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Restoran',
  description: 'Restoran idarəetmə sistemi',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="az">
      <body className="min-h-screen bg-gray-50">{children}</body>
    </html>
  );
}

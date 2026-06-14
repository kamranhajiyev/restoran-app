import type { Metadata } from 'next';
import { Quicksand } from 'next/font/google';
import './globals.css';

const quicksand = Quicksand({
  variable: '--font-quicksand',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'possiblle',
  description: 'Everything possible with us — restoran idarəetmə sistemi',
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

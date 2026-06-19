import type { Metadata } from 'next';

export const metadata: Metadata = {
  manifest: '/seller-manifest.json',
};

export default function SellerLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

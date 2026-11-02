import type { Metadata } from 'next';
import AppFont from '@/components/AppFont';
import SellerSWRegister from './SellerSWRegister';

export const metadata: Metadata = {
  manifest: '/seller-manifest.json',
};

export default function SellerLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppFont>
      <SellerSWRegister />
      {children}
    </AppFont>
  );
}

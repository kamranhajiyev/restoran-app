import type { Metadata } from 'next';
import SellerSWRegister from '@/app/seller/SellerSWRegister';

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string; token: string }> }
): Promise<Metadata> {
  const { slug, token } = await params;
  return {
    manifest: `/api/seller-manifest?slug=${encodeURIComponent(slug)}&token=${encodeURIComponent(token)}`,
  };
}

export default function SellerTokenLayout({ children }: { children: React.ReactNode }) {
  // This is the screen the desktop till actually runs, so this is where the
  // offline worker has to be registered — /seller's does not reach it.
  return (
    <>
      <SellerSWRegister scope="/s/" />
      {children}
    </>
  );
}

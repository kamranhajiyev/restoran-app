import type { Metadata } from 'next';

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string; token: string }> }
): Promise<Metadata> {
  const { slug, token } = await params;
  return {
    manifest: `/api/seller-manifest?slug=${encodeURIComponent(slug)}&token=${encodeURIComponent(token)}`,
  };
}

export default function SellerTokenLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

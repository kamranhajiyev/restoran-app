import AppFont from '@/components/AppFont';

// The kitchen screen reads in Inter like the seller and admin pages: the cook
// sees the same letters the seller typed.
export default function StationLayout({ children }: { children: React.ReactNode }) {
  return <AppFont>{children}</AppFont>;
}

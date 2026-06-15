import type { Metadata } from 'next';
import AdminSWRegister from './AdminSWRegister';

export const metadata: Metadata = {
  manifest: '/admin-manifest.json',
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AdminSWRegister />
      {children}
    </>
  );
}

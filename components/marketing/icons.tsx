import {
  QrCode, ChefHat, Printer, Wallet, BarChart2, Package, Coffee, LayoutGrid, ShieldCheck,
} from 'lucide-react';

// Kept out of lib/features.ts so that file stays plain serialisable data.
export const FEATURE_ICONS: Record<string, React.ElementType> = {
  'qr-menyu':           QrCode,
  'metbex-ekrani':      ChefHat,
  'cek-capi':           Printer,
  'kassa':              Wallet,
  'hesabatlar':         BarChart2,
  'anbar':              Package,
  'menyu-idareetmesi':  Coffee,
  'masalar':            LayoutGrid,
  'emekdaslar':         ShieldCheck,
};

export function IconBox({ Icon, dark }: { Icon: React.ElementType; dark?: boolean }) {
  return (
    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${dark ? 'bg-white/10' : 'bg-black'}`}>
      <Icon className="w-5 h-5 text-white" />
    </div>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import SiteHeader from '@/components/marketing/SiteHeader';
import SiteFooter from '@/components/marketing/SiteFooter';
import { FEATURE_ICONS, IconBox } from '@/components/marketing/icons';
import { FEATURES } from '@/lib/features';

export const metadata: Metadata = {
  title: 'Xüsusiyyətlər — restoran idarəetmə sistemi',
  description:
    'QR menyu, mətbəx ekranı, çek çapı, kassa və növbə, mənfəət hesabatları, anbar və reseptlər, menyu idarəetməsi, zal planı, əməkdaş rolları.',
  alternates: { canonical: '/xususiyyetler' },
};

export default function FeaturesIndex() {
  return (
    <div className="min-h-screen bg-white text-black flex flex-col">
      <SiteHeader />

      <section className="px-6 pt-14 pb-10 border-b border-black/8">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight leading-tight">
            Xüsusiyyətlər
          </h1>
          <p className="mt-5 text-base text-gray-500 leading-relaxed max-w-2xl">
            Sifariş qəbulundan mənfəət hesabatına qədər restoranın gündəlik işini
            bir platformada bağlayan doqquz modul. Hamısı brauzerdə işləyir —
            nə quraşdırma, nə server.
          </p>
        </div>
      </section>

      <section className="px-6 py-14 flex-1">
        <div className="max-w-3xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-4">
          {FEATURES.map(f => (
            <Link
              key={f.slug}
              href={`/xususiyyetler/${f.slug}`}
              className="group bg-[#f5f5f5] rounded-2xl p-6 flex flex-col justify-between min-h-[180px] hover:bg-[#eeeeee] transition-colors"
            >
              <IconBox Icon={FEATURE_ICONS[f.slug]} />
              <div className="mt-6">
                <h2 className="font-bold text-base leading-snug">{f.h1}</h2>
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">{f.tagline}</p>
                <span className="inline-flex items-center gap-1 mt-3 text-xs font-semibold text-black">
                  Ətraflı
                  <ArrowRight className="w-3 h-3 transition-transform group-hover:translate-x-0.5" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

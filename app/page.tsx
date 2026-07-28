import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import SessionRedirect from '@/components/SessionRedirect';
import SiteHeader from '@/components/marketing/SiteHeader';
import SiteFooter from '@/components/marketing/SiteFooter';
import Faq from '@/components/marketing/Faq';
import { JsonLd, faqSchema, softwareSchema } from '@/components/marketing/JsonLd';
import { FEATURE_ICONS, IconBox } from '@/components/marketing/icons';
import { FEATURES, HOME_FAQS, featureBySlug, type Feature } from '@/lib/features';

// A server component on purpose. The session redirect lives in <SessionRedirect />,
// which renders null — so every word below is in the HTML before any JavaScript runs.
export const metadata: Metadata = {
  title: 'Restoran idarəetmə sistemi — QR menyu, kassa, anbar',
  description:
    'QR menyu, sifariş qəbulu, mətbəx ekranı, kassa və növbə nəzarəti, anbar və reseptlər, mənfəət hesabatları. Hamısı bir platformada, brauzerdə işləyir.',
  alternates: { canonical: '/' },
};

// The two cards that lead the grid, each with the number that makes the promise concrete.
const HERO_CARDS: { slug: string; stat: React.ReactNode }[] = [
  {
    slug: 'hesabatlar',
    stat: (
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-4xl font-bold">12,450 ₼</span>
        <span className="text-xs font-semibold bg-black text-white px-2.5 py-1 rounded-full">↑ 18%</span>
      </div>
    ),
  },
  {
    slug: 'qr-menyu',
    stat: (
      <div className="flex items-center gap-2">
        <span className="text-4xl font-bold">47</span>
        <span className="text-sm text-gray-400">sifariş bu gün</span>
      </div>
    ),
  },
];

const HERO_SLUGS = HERO_CARDS.map(c => c.slug);
const DARK_SLUG = 'emekdaslar';

function FeatureCard({ feature, large, stat }: { feature: Feature; large?: boolean; stat?: React.ReactNode }) {
  const Icon = FEATURE_ICONS[feature.slug];
  return (
    <Link
      href={`/xususiyyetler/${feature.slug}`}
      className={`group bg-[#f5f5f5] rounded-2xl flex flex-col justify-between hover:bg-[#eeeeee] transition-colors ${large ? 'p-8 min-h-[260px]' : 'p-7 min-h-[220px]'}`}
    >
      <IconBox Icon={Icon} />
      {stat && <div className="mt-6">{stat}</div>}
      <div className={stat ? '' : 'mt-6'}>
        <h3 className={`font-bold leading-snug ${large ? 'text-2xl' : 'text-base'}`}>{feature.nav}</h3>
        <p className={`text-gray-400 mt-1 leading-relaxed ${large ? 'text-sm' : 'text-xs'}`}>{feature.tagline}</p>
        <span className="inline-flex items-center gap-1 mt-3 text-xs font-semibold text-black">
          Ətraflı
          <ArrowRight className="w-3 h-3 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}

export default function Home() {
  const rest = FEATURES.filter(f => !HERO_SLUGS.includes(f.slug) && f.slug !== DARK_SLUG);
  const staff = featureBySlug(DARK_SLUG)!;

  return (
    <div className="min-h-screen bg-white text-black flex flex-col">
      <SessionRedirect />
      <JsonLd data={softwareSchema()} />
      <JsonLd data={faqSchema(HOME_FAQS)} />

      <SiteHeader />

      {/* Hero */}
      <section className="flex flex-col items-center text-center px-6 pt-20 pb-16">
        <span className="inline-flex items-center gap-2 text-[11px] font-semibold text-gray-500 border border-black/10 rounded-full px-3 py-1 mb-7">
          <span className="w-1.5 h-1.5 bg-black rounded-full" />
          Restoran idarəetmə sistemi
        </span>
        <p className="text-6xl sm:text-8xl font-bold tracking-tight leading-none mb-6">possiblle</p>
        <h1 className="text-xl sm:text-2xl font-semibold leading-snug tracking-tight max-w-2xl text-gray-700">
          Restoranlar üçün{' '}
          <span className="text-black border-b-[3px] border-black pb-0.5">QR menyu</span>
          {' '}və sifariş idarəetmə sistemi
        </h1>
        <p className="mt-4 text-sm text-gray-400">Everything possible with us.</p>
        <p className="mt-5 text-gray-400 text-sm sm:text-base max-w-md leading-relaxed">
          QR sifariş, real vaxt masa izlənməsi, mətbəx bildirişləri, kassa nəzarəti,
          anbar və tam mənfəət hesabatları. Hamısı bir platformada.
        </p>
        <div className="mt-8 flex items-center gap-3">
          <Link
            href="/login"
            className="px-7 py-3 rounded-full bg-black text-white text-sm font-semibold hover:bg-gray-800 transition-colors"
          >
            İndi başla →
          </Link>
          <Link
            href="/xususiyyetler"
            className="px-7 py-3 rounded-full border border-black/15 text-gray-600 text-sm font-semibold hover:border-black/40 transition-colors"
          >
            Daha çox
          </Link>
        </div>
      </section>

      {/* Stat bar */}
      <div className="border-y border-black/8 py-6 px-6">
        <div className="max-w-5xl mx-auto flex flex-wrap justify-center gap-10 text-center">
          {[
            { n: 'Limitsiz', l: 'Masa' },
            { n: 'Real vaxt', l: 'Bildiriş' },
            { n: '100%', l: 'Brauzer əsaslı' },
          ].map(s => (
            <div key={s.l}>
              <p className="text-2xl font-bold">{s.n}</p>
              <p className="text-xs text-gray-400 mt-0.5">{s.l}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Bento features */}
      <section id="features" className="py-16 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-end justify-between mb-10">
            <h2 className="text-3xl sm:text-4xl font-bold leading-tight max-w-xs">
              Bir platformada<br />hər şey.
            </h2>
            <p className="hidden sm:block text-sm text-gray-400 max-w-xs text-right leading-relaxed">
              Restoranınızın hər aspektini<br />idarə etmək üçün lazım olan alətlər.
            </p>
          </div>

          {/* Row 1 — profit first */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            {HERO_CARDS.map(c => (
              <FeatureCard key={c.slug} feature={featureBySlug(c.slug)!} large stat={c.stat} />
            ))}
          </div>

          {/* Row 2 — everything else */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            {rest.map(f => <FeatureCard key={f.slug} feature={f} />)}
          </div>

          {/* Row 3 — full width dark card */}
          <Link
            href={`/xususiyyetler/${staff.slug}`}
            className="group bg-black rounded-2xl p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 hover:bg-gray-900 transition-colors"
          >
            <div className="flex items-start gap-4">
              <IconBox Icon={FEATURE_ICONS[staff.slug]} dark />
              <div>
                <h3 className="text-white font-bold text-lg">Təhlükəsiz. PIN giriş. Tam nəzarət.</h3>
                <p className="text-white/50 text-sm mt-1">{staff.tagline}</p>
              </div>
            </div>
            <span className="flex-shrink-0 inline-flex items-center gap-1 px-6 py-2.5 rounded-full bg-white text-black text-sm font-semibold group-hover:bg-gray-100 transition-colors">
              Ətraflı
              <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-16 px-6 border-t border-black/8">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold mb-8">FAQ</h2>
          <Faq items={HOME_FAQS} />
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

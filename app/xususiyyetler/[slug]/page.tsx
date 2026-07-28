import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, ArrowLeft, Check } from 'lucide-react';
import SiteHeader from '@/components/marketing/SiteHeader';
import SiteFooter from '@/components/marketing/SiteFooter';
import Faq from '@/components/marketing/Faq';
import { JsonLd, faqSchema } from '@/components/marketing/JsonLd';
import { FEATURE_ICONS, IconBox } from '@/components/marketing/icons';
import { FEATURES, featureBySlug } from '@/lib/features';

type Props = { params: Promise<{ slug: string }> };

// Nine static pages, prerendered at build time — there is no data fetching here.
export function generateStaticParams() {
  return FEATURES.map(f => ({ slug: f.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const feature = featureBySlug(slug);
  if (!feature) return {};

  const path = `/xususiyyetler/${feature.slug}`;
  return {
    title: feature.title,
    description: feature.description,
    alternates: { canonical: path },
    openGraph: {
      title: `${feature.title} | possiblle`,
      description: feature.description,
      url: path,
      type: 'article',
    },
  };
}

export default async function FeaturePage({ params }: Props) {
  const { slug } = await params;
  const feature = featureBySlug(slug);
  if (!feature) notFound();

  const Icon = FEATURE_ICONS[feature.slug];
  const others = FEATURES.filter(f => f.slug !== feature.slug);

  return (
    <div className="min-h-screen bg-white text-black flex flex-col">
      <JsonLd data={faqSchema(feature.faqs)} />
      <SiteHeader />

      <article className="flex-1">
        {/* Header */}
        <section className="px-6 pt-14 pb-12 border-b border-black/8">
          <div className="max-w-3xl mx-auto">
            <Link
              href="/xususiyyetler"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-black transition-colors mb-8"
            >
              <ArrowLeft className="w-3 h-3" />
              Bütün xüsusiyyətlər
            </Link>
            <IconBox Icon={Icon} />
            <h1 className="mt-6 text-3xl sm:text-5xl font-bold tracking-tight leading-tight">
              {feature.h1}
            </h1>
            <p className="mt-6 text-base text-gray-500 leading-relaxed max-w-2xl">
              {feature.intro}
            </p>
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 mt-8 px-7 py-3 rounded-full bg-black text-white text-sm font-semibold hover:bg-gray-800 transition-colors"
            >
              İndi başla
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </section>

        {/* Points */}
        <section className="px-6 py-14">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold mb-8">Nə edir?</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {feature.points.map(p => (
                <div key={p.name} className="bg-[#f5f5f5] rounded-2xl p-6">
                  <div className="flex items-center gap-2 mb-2">
                    <Check className="w-4 h-4 text-black flex-shrink-0" />
                    <h3 className="font-bold text-sm leading-snug">{p.name}</h3>
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed">{p.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        {feature.faqs.length > 0 && (
          <section className="px-6 py-14 border-t border-black/8">
            <div className="max-w-2xl mx-auto">
              <h2 className="text-2xl sm:text-3xl font-bold mb-8">Tez-tez verilən suallar</h2>
              <Faq items={feature.faqs} />
            </div>
          </section>
        )}

        {/* CTA */}
        <section className="px-6 pb-14">
          <div className="max-w-3xl mx-auto bg-black rounded-2xl p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            <div>
              <p className="text-white font-bold text-lg">Restoranınızı bir platformadan idarə edin.</p>
              <p className="text-white/50 text-sm mt-1">QR menyudan hesabatlara qədər — hamısı brauzerdə.</p>
            </div>
            <Link
              href="/login"
              className="flex-shrink-0 px-6 py-2.5 rounded-full bg-white text-black text-sm font-semibold hover:bg-gray-100 transition-colors"
            >
              Daxil ol →
            </Link>
          </div>
        </section>

        {/* Cross-links — how the rest of the pages get discovered */}
        <section className="px-6 pb-16 border-t border-black/8 pt-14">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-lg font-bold mb-6">Digər xüsusiyyətlər</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {others.map(f => {
                const OtherIcon = FEATURE_ICONS[f.slug];
                return (
                  <Link
                    key={f.slug}
                    href={`/xususiyyetler/${f.slug}`}
                    className="group flex items-start gap-3 border border-black/10 rounded-xl p-4 hover:border-black/30 transition-colors"
                  >
                    <OtherIcon className="w-4 h-4 mt-0.5 text-gray-400 group-hover:text-black transition-colors flex-shrink-0" />
                    <div>
                      <p className="text-sm font-semibold">{f.nav}</p>
                      <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{f.tagline}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      </article>

      <SiteFooter />
    </div>
  );
}

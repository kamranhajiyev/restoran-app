import type { FeatureFaq } from '@/lib/features';
import { SITE_URL } from '@/lib/site';

// Structured data. Server-rendered into the HTML so search engines read it without
// executing anything.

export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export function faqSchema(faqs: FeatureFaq[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

export function softwareSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'possiblle',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: SITE_URL,
    inLanguage: 'az',
    description:
      'Restoran idarəetmə sistemi: QR menyu, sifariş qəbulu, mətbəx ekranı, kassa, anbar və mənfəət hesabatları.',
  };
}

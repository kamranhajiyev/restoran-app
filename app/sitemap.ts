import type { MetadataRoute } from 'next';
import { FEATURES } from '@/lib/features';
import { SITE_URL } from '@/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return [
    { url: SITE_URL, lastModified, changeFrequency: 'monthly', priority: 1 },
    { url: `${SITE_URL}/xususiyyetler`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
    ...FEATURES.map(f => ({
      url: `${SITE_URL}/xususiyyetler/${f.slug}`,
      lastModified,
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
  ];
}

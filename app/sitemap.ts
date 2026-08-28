import type { MetadataRoute } from 'next';
import { products } from './products/data';

const siteUrl = 'https://technowiz-solutions.sites.openai.com';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    {
      url: siteUrl,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${siteUrl}/about`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    ...products.map((product) => ({
      url: `${siteUrl}${product.path}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.9,
    })),
  ];
}

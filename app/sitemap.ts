import type { MetadataRoute } from 'next'
import { TOPIC_SLUGS } from '@/lib/topics'

const BASE = 'https://verselink-two.vercel.app'

export default function sitemap(): MetadataRoute.Sitemap {
  const static_pages: MetadataRoute.Sitemap = [
    { url: BASE,           lastModified: new Date(), changeFrequency: 'weekly',  priority: 1.0 },
    { url: `${BASE}/ask`,  lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE}/topics`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.9 },
  ]

  const topic_pages: MetadataRoute.Sitemap = TOPIC_SLUGS.map(slug => ({
    url: `${BASE}/topics/${slug}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }))

  return [...static_pages, ...topic_pages]
}

/**
 * app/search/page.tsx
 *
 * This file is a Server Component (no "use client"). It renders the page shell
 * and passes a Server Action down to the SearchBox Client Component.
 *
 * SERVER ACTION vs API ROUTE:
 * A Server Action is a function marked "use server" that runs on the server
 * but can be called directly from a Client Component — no fetch() required.
 * The browser sends a POST under the hood; you never see it. This keeps the
 * GEMINI_API_KEY and SERVICE_ROLE_KEY server-side automatically.
 */

import SearchBox from './SearchBox'
import { searchVerses } from '@/lib/search'
import type { SearchResult } from '@/types'

async function handleSearch(query: string): Promise<SearchResult[]> {
  'use server'
  if (!query.trim()) return []
  return searchVerses(query, 10)
}

export default function SearchPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Semantic Search</h1>
        <p className="text-stone-500 text-sm">
          Ask a question or describe a theme. Results are ranked by meaning, not keywords.
        </p>
      </div>
      <SearchBox onSearch={handleSearch} />
    </div>
  )
}

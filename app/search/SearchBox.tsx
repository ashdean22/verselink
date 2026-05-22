'use client'

/**
 * SearchBox.tsx — Client Component
 *
 * "use client" at the top means this component runs in the browser and can use
 * React hooks (useState, useTransition). It receives the Server Action as a
 * prop so the actual Gemini call happens server-side — the API key never ships
 * to the browser.
 */

import { useState, useTransition } from 'react'
import type { SearchResult } from '@/types'

interface Props {
  onSearch: (query: string) => Promise<SearchResult[]>
}

export default function SearchBox({ onSearch }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isPending, startTransition] = useTransition()
  const [searched, setSearched] = useState(false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim()) return
    setSearched(true)
    startTransition(async () => {
      const res = await onSearch(query)
      setResults(res)
    })
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="flex gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="What does Scripture say about anxiety?"
          className="flex-1 rounded-lg border border-stone-300 px-4 py-2.5 text-sm focus:border-stone-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-stone-800 px-5 py-2.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
        >
          {isPending ? 'Searching…' : 'Search'}
        </button>
      </form>

      {isPending && (
        <p className="text-sm text-stone-400">Embedding query and searching 31k verses…</p>
      )}

      {!isPending && searched && results.length === 0 && (
        <p className="text-sm text-stone-400">No results — embeddings may still be loading.</p>
      )}

      {!isPending && results.length > 0 && (
        <ol className="space-y-3">
          {results.map((r, i) => (
            <li key={r.id} className="rounded-lg border border-stone-200 bg-white p-4 space-y-1">
              <div className="flex items-center justify-between">
                <a
                  href={`/bible/${r.book.toLowerCase().replace(/ /g, '-')}/${r.chapter}`}
                  className="text-sm font-semibold text-stone-700 hover:underline"
                >
                  {r.book} {r.chapter}:{r.verse}
                </a>
                <span className="text-xs text-stone-400">
                  #{i + 1} · {(r.similarity * 100).toFixed(1)}% match
                </span>
              </div>
              <p className="text-stone-800 text-sm leading-relaxed">{r.text}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

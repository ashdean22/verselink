'use client'

import { useState, useEffect } from 'react'
import type { AskResponse } from '@/app/api/ask/route'
import { isVerseCitation } from '@/lib/commentary'

const EXAMPLE_QUESTIONS = [
  "What does Scripture say about anxiety?",
  "How should I handle grief and loss?",
  "What does the Bible say about waiting on God?",
  "How does Scripture describe forgiveness?",
]

const VERSIONS = ['WEB', 'KJV', 'ASV', 'BSB'] as const
type Version = typeof VERSIONS[number]

const LS_KEY = 'verselink:version'

const VERSION_LABELS: Record<Version, string> = {
  WEB: 'World English Bible',
  KJV: 'King James Version',
  ASV: 'American Standard Version',
  BSB: 'Berean Standard Bible',
}

// Parse "Book Name Chapter:Verse" → {book, chapter, verse}
function parseRef(ref: string): { book: string; chapter: number; verse: number } | null {
  const match = ref.match(/^(.+?)\s+(\d+):(\d+)$/)
  if (!match) return null
  return { book: match[1], chapter: parseInt(match[2], 10), verse: parseInt(match[3], 10) }
}

export default function AskBox() {
  const [question, setQuestion]           = useState('')
  const [version, setVersion]             = useState<Version>('WEB')
  const [result, setResult]               = useState<AskResponse | null>(null)
  const [translatedTexts, setTranslated]  = useState<Record<string, string>>({})

  // On mount: restore stored version + pre-fill ?q= param
  useEffect(() => {
    const stored = localStorage.getItem(LS_KEY) as Version | null
    if (stored && VERSIONS.includes(stored)) setVersion(stored)
    const q = new URLSearchParams(window.location.search).get('q')
    if (q) setQuestion(q)
  }, [])

  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [showContext, setShowContext] = useState(false)
  const [elapsed, setElapsed]     = useState<number | null>(null)

  // Re-translate displayed verse text whenever the version or result changes.
  // Retrieval stays on WEB; only the display layer swaps text here.
  useEffect(() => {
    if (!result || version === 'WEB') {
      setTranslated({})
      return
    }

    const refs = result.retrievedVerses
      .map(v => parseRef(v.ref))
      .filter((r): r is NonNullable<typeof r> => r !== null)

    if (!refs.length) return

    let cancelled = false
    fetch('/api/verse-text', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ refs, version }),
    })
      .then(r => r.json())
      .then(data => { if (!cancelled) setTranslated(data.texts ?? {}) })
      .catch(() => { if (!cancelled) setTranslated({}) })

    return () => { cancelled = true }
  }, [version, result])

  async function handleSubmit(q: string) {
    if (!q.trim()) return
    setQuestion(q)
    setLoading(true)
    setError(null)
    setResult(null)
    setTranslated({})
    setElapsed(null)

    const start = Date.now()
    try {
      const res  = await fetch('/api/ask', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ question: q }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Request failed')
      setResult(data)
      setElapsed(Date.now() - start)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const totalContext = (result?.retrievedVerses.length ?? 0) + (result?.retrievedChunks?.length ?? 0)

  return (
    <div className="space-y-6">
      {/* Version selector */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-stone-500 shrink-0">Translation</label>
        <select
          value={version}
          onChange={e => {
            const v = e.target.value as Version
            setVersion(v)
            localStorage.setItem(LS_KEY, v)
          }}
          className="text-sm border border-stone-200 rounded-md px-2 py-1.5 bg-white text-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-400"
        >
          {VERSIONS.map(v => (
            <option key={v} value={v}>{v} — {VERSION_LABELS[v]}</option>
          ))}
        </select>
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => { e.preventDefault(); handleSubmit(question) }}
        className="flex gap-3"
      >
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What does Scripture say about burnout?"
          className="flex-1 rounded-lg border border-stone-300 px-4 py-2.5 text-sm focus:border-stone-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-stone-800 px-5 py-2.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50 shrink-0"
        >
          {loading ? 'Thinking…' : 'Ask'}
        </button>
      </form>

      {/* Example questions */}
      {!result && !loading && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLE_QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => handleSubmit(q)}
              className="rounded-full border border-stone-200 bg-white px-3 py-1 text-xs text-stone-600 hover:border-stone-400 hover:text-stone-800"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="space-y-2 animate-pulse">
          <div className="h-4 bg-stone-200 rounded w-3/4" />
          <div className="h-4 bg-stone-200 rounded w-1/2" />
          <div className="h-4 bg-stone-200 rounded w-2/3" />
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          {error}
        </p>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-5">
          {/* Answer */}
          <div className="rounded-lg border border-stone-200 bg-white p-5 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-stone-400 uppercase tracking-wide">Answer</p>
              {elapsed && (
                <span className="text-xs text-stone-400">{(elapsed / 1000).toFixed(1)}s</span>
              )}
            </div>
            <p className="text-stone-800 leading-relaxed">{result.answer}</p>
          </div>

          {/* Citations */}
          {result.citations.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-stone-400 uppercase tracking-wide">Citations</p>
              <div className="space-y-2">
                {result.citations.map((c, i) => {
                  const verse    = isVerseCitation(c.ref)
                  const [book, chv] = verse ? c.ref.split(/(?<=\D)\s(?=\d)/) : [null, null]
                  const chapter  = chv?.split(':')[0]
                  const slug     = book?.toLowerCase().replace(/ /g, '-')
                  // Swap to selected version; fall back to WEB text if not found
                  const displayText = verse ? (translatedTexts[c.ref] ?? c.text) : c.text

                  return (
                    <div key={i} className="rounded-lg border border-stone-200 bg-white p-4 space-y-1">
                      <div className="flex items-center gap-2">
                        {verse && slug && chapter ? (
                          <a
                            href={`/bible/${slug}/${chapter}?version=${version}`}
                            className="text-sm font-semibold text-stone-700 hover:underline"
                          >
                            {c.ref}
                            <span className="font-normal text-stone-400"> · {version}</span>
                          </a>
                        ) : (
                          <span className="text-sm font-semibold text-indigo-700">{c.ref}</span>
                        )}
                        {!verse && (
                          <span className="text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">
                            commentary
                          </span>
                        )}
                        {!verse && c.tradition && (
                          <span className="text-xs bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">
                            {c.tradition}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-stone-700 italic">&quot;{displayText}&quot;</p>
                      <p className="text-xs text-stone-500">{c.relevance}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Debug toggle */}
          <div className="border-t border-stone-100 pt-4">
            <button
              onClick={() => setShowContext(!showContext)}
              className="text-xs text-stone-400 hover:text-stone-600"
            >
              {showContext ? '▲ Hide' : '▼ Show'} retrieved context ({totalContext} items)
            </button>
            {showContext && (
              <div className="mt-3 space-y-4">
                {result.retrievedVerses.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-stone-400 mb-2">Scripture</p>
                    <ol className="space-y-2">
                      {result.retrievedVerses.map((v, i) => (
                        <li key={i} className="flex gap-3 text-xs text-stone-500">
                          <span className="shrink-0 font-mono w-8">{(v.similarity * 100).toFixed(0)}%</span>
                          <span>
                            <span className="font-semibold text-stone-700">
                              {v.ref}
                              <span className="font-normal text-stone-400"> · {version}</span>
                            </span>
                            {' — '}
                            {translatedTexts[v.ref] ?? v.text}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                {(result.retrievedChunks?.length ?? 0) > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-stone-400 mb-2">Commentary (across traditions)</p>
                    <ol className="space-y-3">
                      {result.retrievedChunks.map((c, i) => (
                        <li key={i} className="flex gap-3 text-xs text-stone-500">
                          <span className="shrink-0 font-mono w-8">{(c.similarity * 100).toFixed(0)}%</span>
                          <span>
                            <span className="font-semibold text-indigo-700">{c.ref}</span>
                            {c.tradition && (
                              <span className="ml-1.5 text-xs bg-amber-50 text-amber-700 px-1 py-0.5 rounded">
                                {c.tradition}
                              </span>
                            )}
                            <span className="block mt-0.5 text-stone-400 line-clamp-3">{c.text}</span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

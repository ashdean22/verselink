'use client'

import { useState } from 'react'
import type { AskResponse } from '@/app/api/ask/route'

const EXAMPLE_QUESTIONS = [
  "What does Scripture say about anxiety?",
  "How should I handle grief and loss?",
  "What does the Bible say about waiting on God?",
  "How does Scripture describe forgiveness?",
]

export default function AskBox() {
  const [question, setQuestion] = useState('')
  const [result, setResult] = useState<AskResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showContext, setShowContext] = useState(false)
  const [elapsed, setElapsed] = useState<number | null>(null)

  async function handleSubmit(q: string) {
    if (!q.trim()) return
    setQuestion(q)
    setLoading(true)
    setError(null)
    setResult(null)
    setElapsed(null)

    const start = Date.now()
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
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

  return (
    <div className="space-y-6">
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
                  const [book, chv] = c.ref.split(/(?<=\D)\s(?=\d)/)
                  const chapter = chv?.split(':')[0]
                  const slug = book?.toLowerCase().replace(/ /g, '-')
                  return (
                    <div key={i} className="rounded-lg border border-stone-200 bg-white p-4 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <a
                          href={`/bible/${slug}/${chapter}`}
                          className="text-sm font-semibold text-stone-700 hover:underline shrink-0"
                        >
                          {c.ref}
                        </a>
                      </div>
                      <p className="text-sm text-stone-700 italic">"{c.text}"</p>
                      <p className="text-xs text-stone-500">{c.relevance}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Debug toggle — shows the raw retrieved verses + similarity scores */}
          <div className="border-t border-stone-100 pt-4">
            <button
              onClick={() => setShowContext(!showContext)}
              className="text-xs text-stone-400 hover:text-stone-600"
            >
              {showContext ? '▲ Hide' : '▼ Show'} retrieved context ({result.retrievedVerses.length} verses)
            </button>
            {showContext && (
              <ol className="mt-3 space-y-2">
                {result.retrievedVerses.map((v, i) => (
                  <li key={i} className="flex gap-3 text-xs text-stone-500">
                    <span className="shrink-0 font-mono w-8">{(v.similarity * 100).toFixed(0)}%</span>
                    <span>
                      <span className="font-semibold text-stone-700">{v.ref}</span> — {v.text}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

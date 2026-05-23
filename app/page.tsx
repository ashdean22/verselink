import CallNowButton from './CallNowButton'

export default function Home() {
  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="space-y-3">
        <h1 className="text-4xl font-bold tracking-tight">VerseLink</h1>
        <p className="text-lg text-stone-600">
          Ask what Scripture says about anything — burnout, grief, purpose, waiting.
          Get semantically relevant verses, not keyword matches.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <a
          href="/ask"
          className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm hover:border-stone-400 transition-colors"
        >
          <h2 className="font-semibold mb-1">Ask Scripture</h2>
          <p className="text-sm text-stone-500">Get grounded answers with verse citations.</p>
        </a>
        <a
          href="/bible/john/1"
          className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm hover:border-stone-400 transition-colors"
        >
          <h2 className="font-semibold mb-1">Browse Bible</h2>
          <p className="text-sm text-stone-500">Read any chapter of the World English Bible.</p>
        </a>
        <a
          href="/search"
          className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm hover:border-stone-400 transition-colors"
        >
          <h2 className="font-semibold mb-1">Semantic Search</h2>
          <p className="text-sm text-stone-500">Find verses by meaning, not just keywords.</p>
        </a>
        <CallNowButton />
      </div>

      <p className="text-xs text-stone-400">
        Scripture from the World English Bible (WEB) — public domain.
        Commentary by Matthew Henry (1708) — public domain.
      </p>
    </div>
  )
}

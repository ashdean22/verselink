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
          className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm hover:border-stone-400 transition-colors"
        >
          <h2 className="text-lg font-bold mb-1">Ask Scripture</h2>
          <p className="text-sm text-stone-500">Ask any question. Get grounded answers with verse citations and Matthew Henry's commentary.</p>
        </a>
        <a
          href="/bible"
          className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm hover:border-stone-400 transition-colors"
        >
          <h2 className="text-lg font-bold mb-1">Browse Bible</h2>
          <p className="text-sm text-stone-500">Read any of the 66 books of the World English Bible, chapter by chapter.</p>
        </a>
        <a
          href="/topics"
          className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm hover:border-stone-400 transition-colors"
        >
          <h2 className="text-lg font-bold mb-1">Topics</h2>
          <p className="text-sm text-stone-500">Anxiety, grief, forgiveness, hope — 50 topics with curated Scripture and commentary.</p>
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

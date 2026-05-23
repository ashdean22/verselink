import { TOPICS } from '@/lib/topics'

export const metadata = {
  title: 'Bible Topics — VerseLink',
  description: 'Explore what Scripture says about 50 key topics — anxiety, faith, love, forgiveness, and more. AI-powered answers grounded in Bible verses.',
}

export default function TopicsPage() {
  const entries = Object.entries(TOPICS)

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Bible Topics</h1>
        <p className="text-stone-500">
          What does Scripture say about the things that matter most?
          Each page is grounded in retrieved Bible verses and Matthew Henry's commentary.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
        {entries.map(([slug, topic]) => (
          <a
            key={slug}
            href={`/topics/${slug}`}
            className="rounded-lg border border-stone-200 bg-white px-4 py-3 shadow-sm hover:border-stone-400 hover:shadow-md transition-all group"
          >
            <p className="font-semibold text-stone-800 group-hover:text-stone-900 text-sm">
              {topic.title}
            </p>
            <p className="text-xs text-stone-400 mt-0.5 line-clamp-1">{topic.question}</p>
          </a>
        ))}
      </div>
    </div>
  )
}

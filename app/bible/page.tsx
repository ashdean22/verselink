import { BIBLE_BOOKS } from '@/lib/bible-books'

export const metadata = {
  title: 'Browse the Bible — VerseLink',
  description: 'Read any book and chapter of the World English Bible (WEB), public domain.',
}

export default function BibleLandingPage() {
  const ot = BIBLE_BOOKS.filter(b => b.testament === 'OT')
  const nt = BIBLE_BOOKS.filter(b => b.testament === 'NT')

  return (
    <div className="max-w-4xl mx-auto space-y-10">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Browse the Bible</h1>
        <p className="text-stone-500">World English Bible (WEB) — public domain. Click any book to start reading.</p>
      </div>

      <section className="space-y-4">
        <h2 className="text-xs font-semibold text-stone-400 uppercase tracking-widest">Old Testament</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {ot.map(book => (
            <a
              key={book.slug}
              href={`/bible/${book.slug}/1`}
              className="rounded-lg border border-stone-200 bg-white px-3 py-2.5 hover:border-stone-400 hover:bg-stone-50 transition-colors"
            >
              <p className="text-sm font-medium text-stone-800 truncate">{book.name}</p>
              <p className="text-xs text-stone-400 mt-0.5">{book.chapters} ch.</p>
            </a>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xs font-semibold text-stone-400 uppercase tracking-widest">New Testament</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {nt.map(book => (
            <a
              key={book.slug}
              href={`/bible/${book.slug}/1`}
              className="rounded-lg border border-stone-200 bg-white px-3 py-2.5 hover:border-stone-400 hover:bg-stone-50 transition-colors"
            >
              <p className="text-sm font-medium text-stone-800 truncate">{book.name}</p>
              <p className="text-xs text-stone-400 mt-0.5">{book.chapters} ch.</p>
            </a>
          ))}
        </div>
      </section>

      <p className="text-xs text-stone-400 border-t border-stone-100 pt-4">
        Scripture from the World English Bible (WEB) — public domain.
      </p>
    </div>
  )
}

/**
 * /bible/[book]/[chapter] — Server Component
 *
 * In Next.js App Router, files named page.tsx without "use client" at the top
 * are Server Components: they run on the server, can use secret env vars and
 * database calls directly, and send finished HTML to the browser.
 */

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import { SLUG_TO_BOOK, BIBLE_BOOKS } from '@/lib/bible-books'
import BibleNav from './BibleNav'

interface PageProps {
  params: Promise<{ book: string; chapter: string }>
}

export default async function BibleChapterPage({ params }: PageProps) {
  const { book: bookSlug, chapter: chapterStr } = await params
  const bookEntry = SLUG_TO_BOOK[bookSlug]
  const chapterNum = parseInt(chapterStr, 10)

  if (!bookEntry || isNaN(chapterNum)) notFound()

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: verses, error } = await supabase
    .from('verses')
    .select('id, book, chapter, verse, text')
    .eq('book', bookEntry.name)
    .eq('chapter', chapterNum)
    .order('verse', { ascending: true })

  if (error || !verses || verses.length === 0) notFound()

  const bookIdx = BIBLE_BOOKS.findIndex(b => b.slug === bookSlug)
  const prevBook = bookIdx > 0 ? BIBLE_BOOKS[bookIdx - 1] : null
  const prevHref = chapterNum > 1
    ? `/bible/${bookSlug}/${chapterNum - 1}`
    : prevBook ? `/bible/${prevBook.slug}/${prevBook.chapters}` : null
  const nextHref = chapterNum < bookEntry.chapters
    ? `/bible/${bookSlug}/${chapterNum + 1}`
    : bookIdx < BIBLE_BOOKS.length - 1 ? `/bible/${BIBLE_BOOKS[bookIdx + 1].slug}/1` : null

  return (
    <div className="max-w-3xl mx-auto">
      <BibleNav currentSlug={bookSlug} currentChapter={chapterNum} />

      <div className="space-y-6">
        <div className="space-y-1">
          <p className="text-sm text-stone-400 uppercase tracking-wide">World English Bible</p>
          <h1 className="text-3xl font-bold">{bookEntry.name} {chapterNum}</h1>
        </div>

        <ol className="space-y-3">
          {verses.map((v) => (
            <li key={v.id} className="flex gap-3">
              <span className="mt-0.5 text-xs font-medium text-stone-400 w-6 shrink-0 text-right">
                {v.verse}
              </span>
              <p className="text-stone-800 leading-relaxed">{v.text}</p>
            </li>
          ))}
        </ol>

        <div className="flex justify-between pt-6 border-t border-stone-200">
          {prevHref ? (
            <Link href={prevHref} className="text-sm text-stone-500 hover:text-stone-800">
              ← Previous
            </Link>
          ) : <span />}
          {nextHref ? (
            <Link href={nextHref} className="text-sm text-stone-500 hover:text-stone-800">
              Next →
            </Link>
          ) : <span />}
        </div>
      </div>
    </div>
  )
}

export async function generateMetadata({ params }: PageProps) {
  const { book, chapter } = await params
  const bookEntry = SLUG_TO_BOOK[book]
  const bookName = bookEntry?.name ?? book
  return {
    title: `${bookName} ${chapter} — VerseLink`,
  }
}

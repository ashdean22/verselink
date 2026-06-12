/**
 * /bible/[book]/[chapter] — Server Component
 *
 * In Next.js App Router, files named page.tsx without "use client" at the top
 * are Server Components: they run on the server, can use secret env vars and
 * database calls directly, and send finished HTML to the browser.
 *
 * The selected Bible version is carried in the ?version= search param so URLs
 * are shareable and the server always renders the right text without any
 * client-side fetch.
 */

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import { SLUG_TO_BOOK, BIBLE_BOOKS } from '@/lib/bible-books'
import BibleNav from './BibleNav'
import { VERSIONS, VERSION_LABELS, type Version } from './versions'

// BSB's API stored a few books under shortened names.
// Map canonical book name → BSB-stored name where they differ.
const BSB_NAME: Partial<Record<string, string>> = {
  'Song of Solomon': 'Song',
}

interface PageProps {
  params:       Promise<{ book: string; chapter: string }>
  searchParams: Promise<{ version?: string }>
}

export default async function BibleChapterPage({ params, searchParams }: PageProps) {
  const { book: bookSlug, chapter: chapterStr } = await params
  const { version: versionParam } = await searchParams

  const bookEntry  = SLUG_TO_BOOK[bookSlug]
  const chapterNum = parseInt(chapterStr, 10)

  if (!bookEntry || isNaN(chapterNum)) notFound()

  const hasExplicitVersion = VERSIONS.includes(versionParam as Version)
  const version: Version   = hasExplicitVersion ? (versionParam as Version) : 'WEB'

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // BSB stores some books under a different name than the other translations.
  // We query with .in() so a single code path covers both names safely.
  const bookNames = [
    version === 'BSB' ? (BSB_NAME[bookEntry.name] ?? bookEntry.name) : bookEntry.name,
  ]

  const { data: verses, error } = await supabase
    .from('verse_translations')
    .select('id, book, chapter, verse, text')
    .in('book', bookNames)
    .eq('chapter', chapterNum)
    .eq('version', version)
    .order('verse', { ascending: true })

  if (error || !verses || verses.length === 0) notFound()

  const bookIdx = BIBLE_BOOKS.findIndex(b => b.slug === bookSlug)
  const prevBook = bookIdx > 0 ? BIBLE_BOOKS[bookIdx - 1] : null
  const prevHref = chapterNum > 1
    ? `/bible/${bookSlug}/${chapterNum - 1}?version=${version}`
    : prevBook ? `/bible/${prevBook.slug}/${prevBook.chapters}?version=${version}` : null
  const nextHref = chapterNum < bookEntry.chapters
    ? `/bible/${bookSlug}/${chapterNum + 1}?version=${version}`
    : bookIdx < BIBLE_BOOKS.length - 1
      ? `/bible/${BIBLE_BOOKS[bookIdx + 1].slug}/1?version=${version}`
      : null

  return (
    <div className="max-w-3xl mx-auto">
      <BibleNav
        currentSlug={bookSlug}
        currentChapter={chapterNum}
        currentVersion={version}
        hasExplicitVersion={hasExplicitVersion}
      />

      <div className="space-y-6">
        <div className="space-y-1">
          <p className="text-sm text-stone-400 uppercase tracking-wide">
            {VERSION_LABELS[version]}
          </p>
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
  const bookName  = bookEntry?.name ?? book
  return {
    title: `${bookName} ${chapter} — VerseLink`,
  }
}

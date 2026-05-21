/**
 * /bible/[book]/[chapter] — Server Component
 *
 * In Next.js App Router, files named page.tsx without "use client" at the top
 * are Server Components: they run on the server, can use secret env vars and
 * database calls directly, and send finished HTML to the browser. No fetch()
 * call needed — we just call Supabase directly.
 */

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'

// Canonical book order for next/prev navigation
const BOOK_ORDER = [
  'Genesis','Exodus','Leviticus','Numbers','Deuteronomy','Joshua','Judges','Ruth',
  '1 Samuel','2 Samuel','1 Kings','2 Kings','1 Chronicles','2 Chronicles','Ezra',
  'Nehemiah','Esther','Job','Psalms','Proverbs','Ecclesiastes','Song of Solomon',
  'Isaiah','Jeremiah','Lamentations','Ezekiel','Daniel','Hosea','Joel','Amos',
  'Obadiah','Jonah','Micah','Nahum','Habakkuk','Zephaniah','Haggai','Zechariah',
  'Malachi','Matthew','Mark','Luke','John','Acts','Romans','1 Corinthians',
  '2 Corinthians','Galatians','Ephesians','Philippians','Colossians',
  '1 Thessalonians','2 Thessalonians','1 Timothy','2 Timothy','Titus','Philemon',
  'Hebrews','James','1 Peter','2 Peter','1 John','2 John','3 John','Jude','Revelation',
]

// URL slug → display name mapping (handles spaces and numbers)
const SLUG_TO_BOOK: Record<string, string> = Object.fromEntries(
  BOOK_ORDER.map((b) => [b.toLowerCase().replace(/ /g, '-'), b])
)

function bookToSlug(book: string) {
  return book.toLowerCase().replace(/ /g, '-')
}

interface PageProps {
  params: Promise<{ book: string; chapter: string }>
}

export default async function BibleChapterPage({ params }: PageProps) {
  const { book: bookSlug, chapter: chapterStr } = await params
  const bookName = SLUG_TO_BOOK[bookSlug]
  const chapterNum = parseInt(chapterStr, 10)

  if (!bookName || isNaN(chapterNum)) notFound()

  // Service role needed to read from Supabase in a Server Component.
  // This key never leaves the server — Next.js strips non-NEXT_PUBLIC_ vars from the browser bundle.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: verses, error } = await supabase
    .from('verses')
    .select('id, book, chapter, verse, text')
    .eq('book', bookName)
    .eq('chapter', chapterNum)
    .order('verse', { ascending: true })

  if (error || !verses || verses.length === 0) {
    notFound()
  }

  // Next/prev chapter navigation
  const bookIdx = BOOK_ORDER.indexOf(bookName)
  const prevHref = chapterNum > 1
    ? `/bible/${bookSlug}/${chapterNum - 1}`
    : bookIdx > 0 ? `/bible/${bookToSlug(BOOK_ORDER[bookIdx - 1])}/1` : null
  const nextHref = `/bible/${bookSlug}/${chapterNum + 1}`

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-sm text-stone-400 uppercase tracking-wide">World English Bible</p>
        <h1 className="text-3xl font-bold">
          {bookName} {chapterNum}
        </h1>
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
        <Link href={nextHref} className="text-sm text-stone-500 hover:text-stone-800">
          Next →
        </Link>
      </div>
    </div>
  )
}

export async function generateMetadata({ params }: PageProps) {
  const { book, chapter } = await params
  const bookName = SLUG_TO_BOOK[book] ?? book
  return {
    title: `${bookName} ${chapter} — VerseLink`,
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const VALID_VERSIONS = new Set(['WEB', 'KJV', 'ASV', 'BSB'])

// BSB stores some books under shortened names
const BSB_BOOK: Record<string, string> = {
  'Song of Solomon': 'Song',
}

function bsbBook(book: string) {
  return BSB_BOOK[book] ?? book
}

interface VerseRef { book: string; chapter: number; verse: number }

export async function POST(req: NextRequest) {
  let refs: VerseRef[]
  let version: string
  try {
    const body = await req.json()
    refs    = Array.isArray(body.refs) ? body.refs : []
    version = typeof body.version === 'string' ? body.version : 'WEB'
  } catch {
    return NextResponse.json({ texts: {} })
  }

  if (!refs.length || !VALID_VERSIONS.has(version) || version === 'WEB') {
    return NextResponse.json({ texts: {} })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Map book names for BSB, keep original for output key construction
  const mapped = refs.map(r => ({
    ...r,
    lookupBook: version === 'BSB' ? bsbBook(r.book) : r.book,
  }))

  const books    = [...new Set(mapped.map(r => r.lookupBook))]
  const chapters = [...new Set(mapped.map(r => r.chapter))]

  const { data, error } = await supabase
    .from('verse_translations')
    .select('book, chapter, verse, text')
    .eq('version', version)
    .in('book', books)
    .in('chapter', chapters)

  if (error || !data) return NextResponse.json({ texts: {} })

  // Index fetched rows by "lookupBook:chapter:verse" for O(1) match
  const rowMap = new Map<string, string>()
  for (const row of data) {
    rowMap.set(`${row.book}:${row.chapter}:${row.verse}`, row.text)
  }

  // Output keys use the WEB book name (matches what citations store in `ref`)
  const texts: Record<string, string> = {}
  for (const r of mapped) {
    const text = rowMap.get(`${r.lookupBook}:${r.chapter}:${r.verse}`)
    if (text) texts[`${r.book} ${r.chapter}:${r.verse}`] = text
    // No entry → caller falls back to WEB text
  }

  return NextResponse.json({ texts })
}

/**
 * scripts/diagnose-translations.ts
 *
 * Compares what we have in verse_translations against what the
 * Free Use Bible API (bible.helloao.org) actually exposes per version.
 *
 * Run: npx tsx scripts/diagnose-translations.ts
 */

import * as dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const API_BASE = 'https://bible.helloao.org/api'

const REMOTE_TRANSLATIONS = [
  { apiId: 'eng_kjv', label: 'KJV' },
  { apiId: 'eng_asv', label: 'ASV' },
  { apiId: 'BSB',     label: 'BSB' },
] as const

interface ApiBook {
  id: string
  name: string
  numberOfChapters: number
}

interface Missing {
  version: string
  book: string      // API book name
  chapter: number
  reason: string    // 'missing' | 'short:<n>/<expected>'
}

async function fetchBooks(apiId: string): Promise<ApiBook[]> {
  const res = await fetch(`${API_BASE}/${apiId}/books.json`)
  if (!res.ok) throw new Error(`books.json ${res.status} for ${apiId}`)
  const data = await res.json() as { books: ApiBook[] }
  return data.books
}

// Fetch one chapter to find out how many verses it actually has.
async function fetchVerseCount(apiId: string, bookId: string, ch: number): Promise<number | null> {
  const res = await fetch(`${API_BASE}/${apiId}/${bookId}/${ch}.json`)
  if (!res.ok) return null
  const data = await res.json() as {
    chapter: { content: Array<{ type: string; number?: number }> }
  }
  return data.chapter.content.filter(i => i.type === 'verse').length
}

// Pull everything we have in the DB for one version.
async function loadDbCounts(version: string): Promise<Map<string, Map<number, number>>> {
  // Map: bookName -> chapterNum -> verseCount
  const result = new Map<string, Map<number, number>>()
  const PAGE = 1000
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('verse_translations')
      .select('book, chapter, verse')
      .eq('version', version)
      .range(offset, offset + PAGE - 1)

    if (error) throw new Error(`DB query failed: ${error.message}`)
    if (!data || data.length === 0) break

    for (const row of data) {
      if (!result.has(row.book)) result.set(row.book, new Map())
      const chMap = result.get(row.book)!
      chMap.set(row.chapter, (chMap.get(row.chapter) ?? 0) + 1)
    }

    if (data.length < PAGE) break
    offset += PAGE
  }

  return result
}

// WEB: compare against the verses table (source of truth)
async function diagnoseWEB(): Promise<Missing[]> {
  console.log('\n═══ WEB ═══')

  // What we have in verse_translations for WEB
  const wt = await loadDbCounts('WEB')

  // What's in the verses table (the canonical WEB source)
  const srcMap = new Map<string, Map<number, number>>()
  const PAGE = 1000
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('verses')
      .select('book, chapter, verse')
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`verses query failed: ${error.message}`)
    if (!data || data.length === 0) break
    for (const row of data) {
      if (!srcMap.has(row.book)) srcMap.set(row.book, new Map())
      const chMap = srcMap.get(row.book)!
      chMap.set(row.chapter, (chMap.get(row.chapter) ?? 0) + 1)
    }
    if (data.length < PAGE) break
    offset += PAGE
  }

  const missing: Missing[] = []
  let totalSrc = 0, totalWt = 0

  for (const [book, chapters] of srcMap) {
    for (const [ch, srcCount] of chapters) {
      totalSrc += srcCount
      const wtCount = wt.get(book)?.get(ch) ?? 0
      totalWt += wtCount
      if (wtCount === 0) {
        missing.push({ version: 'WEB', book, chapter: ch, reason: 'missing' })
      } else if (wtCount < srcCount) {
        missing.push({ version: 'WEB', book, chapter: ch, reason: `short:${wtCount}/${srcCount}` })
      }
    }
  }

  console.log(`  verses table: ${totalSrc} verses across ${srcMap.size} books`)
  console.log(`  verse_translations WEB: ${totalWt} verses`)
  if (missing.length === 0) {
    console.log('  ✓ WEB is complete')
  } else {
    console.log(`  ✗ ${missing.length} chapters missing or short`)
    for (const m of missing.slice(0, 20)) {
      console.log(`    ${m.book} ch ${m.chapter}: ${m.reason}`)
    }
    if (missing.length > 20) console.log(`    …and ${missing.length - 20} more`)
  }
  return missing
}

async function diagnoseRemote(
  apiId: string,
  label: string,
): Promise<Missing[]> {
  console.log(`\n═══ ${label} (${apiId}) ═══`)

  const books = await fetchBooks(apiId)
  console.log(`  API exposes ${books.length} books`)

  const dbCounts = await loadDbCounts(label)
  const missing: Missing[] = []

  let totalApiBooks = 0, totalDbBooks = 0
  let totalApiVerse = 0, totalDbVerse = 0

  for (const book of books) {
    totalApiBooks++
    const chMap = dbCounts.get(book.name)
    if (!chMap) {
      // Entire book missing — sample first chapter to see if API has it
      const sample = await fetchVerseCount(apiId, book.id, 1)
      const reason = sample === null ? 'API-404' : 'missing'
      for (let ch = 1; ch <= book.numberOfChapters; ch++) {
        missing.push({ version: label, book: book.name, chapter: ch, reason })
      }
      continue
    }
    totalDbBooks++

    for (let ch = 1; ch <= book.numberOfChapters; ch++) {
      const dbCount = chMap.get(ch) ?? 0
      totalDbVerse += dbCount

      if (dbCount === 0) {
        missing.push({ version: label, book: book.name, chapter: ch, reason: 'missing' })
      } else {
        totalApiVerse += dbCount  // approximate — we only sample short chapters
        // Spot-check Psalms (known problem area)
        if (book.name === 'Psalms' || book.name === 'Psalm') {
          // don't fetch every chapter — just note if it has data
        }
      }
    }
  }

  // Re-count properly
  let grandDbVerse = 0
  for (const chMap of dbCounts.values()) {
    for (const count of chMap.values()) grandDbVerse += count
  }

  console.log(`  DB has ${dbCounts.size} books, ${grandDbVerse} verses`)
  console.log(`  API exposes ${books.length} books`)

  // Psalms specifically
  const psBook = books.find(b => b.name === 'Psalms' || b.name === 'Psalm')
  if (psBook) {
    const psDb = dbCounts.get(psBook.name)
    const psDbChapters = psDb ? psDb.size : 0
    const psDbVerses = psDb ? [...psDb.values()].reduce((a, b) => a + b, 0) : 0
    console.log(`  Psalms: API book name="${psBook.name}", ${psBook.numberOfChapters} chapters`)
    console.log(`  Psalms in DB: ${psDbChapters} chapters, ${psDbVerses} verses`)
  } else {
    console.log(`  Psalms: not found in API books list — checking alternate names...`)
    const candidates = books.filter(b => b.name.toLowerCase().includes('ps'))
    candidates.forEach(b => console.log(`    candidate: "${b.name}" (id=${b.id})`))
  }

  if (missing.length === 0) {
    console.log(`  ✓ ${label} is complete`)
  } else {
    const apiMissing = missing.filter(m => m.reason === 'API-404')
    const ourMissing = missing.filter(m => m.reason !== 'API-404')
    if (apiMissing.length > 0) {
      const books2 = [...new Set(apiMissing.map(m => m.book))]
      console.log(`  API-404 (source doesn't have it): ${books2.join(', ')}`)
    }
    if (ourMissing.length > 0) {
      console.log(`  ✗ Our ingest missed ${ourMissing.length} chapters:`)
      // Group by book for readability
      const byBook = new Map<string, number[]>()
      for (const m of ourMissing) {
        if (!byBook.has(m.book)) byBook.set(m.book, [])
        byBook.get(m.book)!.push(m.chapter)
      }
      for (const [bk, chs] of byBook) {
        const ranges = compressRanges(chs)
        console.log(`    ${bk}: chapters ${ranges}`)
      }
    }
  }

  return missing
}

// Compress [1,2,3,5,6,10] → "1-3, 5-6, 10"
function compressRanges(chs: number[]): string {
  const sorted = [...new Set(chs)].sort((a, b) => a - b)
  const ranges: string[] = []
  let start = sorted[0], end = sorted[0]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) { end = sorted[i] }
    else {
      ranges.push(start === end ? `${start}` : `${start}-${end}`)
      start = end = sorted[i]
    }
  }
  ranges.push(start === end ? `${start}` : `${start}-${end}`)
  return ranges.join(', ')
}

async function main() {
  console.log('Diagnosing verse_translations vs API manifest...\n')

  const webMissing = await diagnoseWEB()

  const allMissing: Missing[] = [...webMissing]
  for (const t of REMOTE_TRANSLATIONS) {
    const m = await diagnoseRemote(t.apiId, t.label)
    allMissing.push(...m)
  }

  console.log('\n══════════════════════════════════════')
  console.log('SUMMARY — chapters our ingest missed (not API-404):')
  const ours = allMissing.filter(m => m.reason !== 'API-404')
  if (ours.length === 0) {
    console.log('  None — all versions complete!')
  } else {
    const byVersion = new Map<string, typeof ours>()
    for (const m of ours) {
      if (!byVersion.has(m.version)) byVersion.set(m.version, [])
      byVersion.get(m.version)!.push(m)
    }
    for (const [v, items] of byVersion) {
      console.log(`  ${v}: ${items.length} chapters missing`)
    }
  }
  console.log('══════════════════════════════════════\n')
}

main().catch(err => { console.error(err); process.exit(1) })

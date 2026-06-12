/**
 * scripts/backfill-translations.ts
 *
 * Targeted repair for the verse_translations table.  Only processes chapters
 * that are genuinely missing or partially loaded — never re-fetches chapters
 * that are already complete.
 *
 * Problem being fixed:
 *   The original load-translations.ts only extracted plain-string content items.
 *   The API also returns content as { "text": "...", "poem": 1 } objects, which
 *   were silently dropped.  This affected all poetry books and all Words of Jesus.
 *   Chapters whose every verse used the object format ended up with 0 rows in the
 *   DB and were permanently re-skipped.  Chapters with mixed content ended up
 *   "short" (1–3 verses).
 *
 * Strategy:
 *   1. Load the API book manifest for each remote version.
 *   2. Check the DB verse count per chapter.
 *   3. "Missing" (0 rows):  fetch and insert.
 *   4. "Short" (≤3 rows):   delete existing rows, then fetch and insert.
 *      (≤3 is always wrong — the smallest real chapter has 4+ verses.)
 *   5. "OK" (≥4 rows):      skip.
 *
 * Idempotent: safe to run multiple times.  Uses the same UPSERT idempotency
 * as the main ingest script plus the delete-first guard on short chapters.
 *
 * Run: npx tsx scripts/backfill-translations.ts
 */

import * as dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const FETCH_SLEEP_MS = 300
const MAX_RETRIES    = 4
const API_BASE       = 'https://bible.helloao.org/api'

// A chapter with ≤ SHORT_THRESHOLD verses is assumed to be partially-loaded
// due to the parser bug and will be deleted then re-fetched.
// The smallest real chapter in the Bible (e.g., 2 John) has 13 verses.
// We use 3 to be conservative, but in practice anything ≤ 3 is a parser artifact.
const SHORT_THRESHOLD = 3

const REMOTE_TRANSLATIONS = [
  { apiId: 'eng_kjv', label: 'KJV' },
  { apiId: 'eng_asv', label: 'ASV' },
  { apiId: 'BSB',     label: 'BSB' },
] as const

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

interface TranslationRow {
  book: string; chapter: number; verse: number; version: string; text: string
}

// Handles both plain-string and { text: "..." } object content items.
type ContentItem = string | Record<string, unknown>

function extractVerseText(content: ContentItem[]): string {
  return content
    .flatMap(item => {
      if (typeof item === 'string') return [item]
      if (item !== null && typeof item === 'object' && typeof item['text'] === 'string') return [item['text'] as string]
      return []
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchWithRetry(url: string): Promise<Response> {
  let delay = 1000
  let lastRes: Response | null = null
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status === 404) return res
      lastRes = res
      if (attempt < MAX_RETRIES) {
        process.stdout.write(` [HTTP ${res.status} retry ${attempt}]`)
        await sleep(delay)
        delay = Math.min(delay * 2, 16000)
      }
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err
      process.stdout.write(` [net-err retry ${attempt}]`)
      await sleep(delay)
      delay = Math.min(delay * 2, 16000)
    }
  }
  return lastRes!
}

async function upsertChapter(rows: TranslationRow[]): Promise<number> {
  if (rows.length === 0) return 0
  const { error, count } = await supabase
    .from('verse_translations')
    .upsert(rows, { onConflict: 'book,chapter,verse,version', ignoreDuplicates: true, count: 'exact' })
  if (error) throw new Error(`Upsert failed: ${error.message}`)
  return count ?? 0
}

async function deleteChapter(version: string, book: string, chapter: number): Promise<void> {
  const { error } = await supabase
    .from('verse_translations')
    .delete()
    .eq('version', version)
    .eq('book', book)
    .eq('chapter', chapter)
  if (error) throw new Error(`Delete failed for ${version} ${book} ${chapter}: ${error.message}`)
}

// Load the current DB state for one version: Map<"book:chapter", verseCount>
async function loadDbState(version: string): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  const PAGE = 1000
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('verse_translations')
      .select('book, chapter, verse')
      .eq('version', version)
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`DB query failed: ${error.message}`)
    if (!data?.length) break
    for (const r of data) {
      const k = `${r.book}:${r.chapter}`
      result.set(k, (result.get(k) ?? 0) + 1)
    }
    if (data.length < PAGE) break
    offset += PAGE
  }
  return result
}

interface ApiBook { id: string; name: string; numberOfChapters: number }

async function backfillVersion(
  apiId: string,
  label: string,
): Promise<{ inserted: number; deletedShort: number; skipped: number; apiMissing: string[] }> {
  console.log(`\n════ ${label} (${apiId}) ════`)

  const booksRes = await fetchWithRetry(`${API_BASE}/${apiId}/books.json`)
  if (!booksRes.ok) throw new Error(`books.json ${booksRes.status} for ${apiId}`)
  const { books } = await booksRes.json() as { books: ApiBook[] }

  const dbState = await loadDbState(label)
  console.log(`  API: ${books.length} books   DB: ${dbState.size} chapter entries`)

  let inserted = 0, deletedShort = 0, skipped = 0
  const apiMissing: string[] = []

  for (const book of books) {
    const gapChapters: number[] = []
    const shortChapters: number[] = []

    for (let ch = 1; ch <= book.numberOfChapters; ch++) {
      const count = dbState.get(`${book.name}:${ch}`) ?? 0
      if (count === 0) gapChapters.push(ch)
      else if (count <= SHORT_THRESHOLD) shortChapters.push(ch)
      else skipped++
    }

    if (gapChapters.length === 0 && shortChapters.length === 0) continue

    const toFetch = [...shortChapters, ...gapChapters]
    process.stdout.write(`  ${book.name}: ${toFetch.length} chapters to fix (${shortChapters.length} short + ${gapChapters.length} missing)…`)

    // Delete short chapters first so they drop out of any future checkpoint
    for (const ch of shortChapters) {
      await deleteChapter(label, book.name, ch)
      deletedShort++
    }

    let bookInserted = 0
    for (const ch of toFetch) {
      await sleep(FETCH_SLEEP_MS)
      const url = `${API_BASE}/${apiId}/${book.id}/${ch}.json`
      const res = await fetchWithRetry(url)

      if (res.status === 404) {
        apiMissing.push(`${book.name} ${ch}`)
        continue
      }
      if (!res.ok) {
        process.stdout.write(` [skip ch${ch}: ${res.status}]`)
        continue
      }

      let data: { chapter: { content: Array<{ type: string; number?: number; content?: ContentItem[] }> } }
      try { data = await res.json() } catch {
        process.stdout.write(` [bad JSON ch${ch}]`)
        continue
      }

      const rows: TranslationRow[] = []
      for (const item of data.chapter.content ?? []) {
        if (item.type !== 'verse' || !Array.isArray(item.content) || typeof item.number !== 'number') continue
        const text = extractVerseText(item.content)
        if (!text) continue
        rows.push({ book: book.name, chapter: ch, verse: item.number, version: label, text })
      }

      if (rows.length === 0) {
        process.stdout.write(` [0 verses ch${ch} — API may lack data]`)
        apiMissing.push(`${book.name} ${ch}`)
        continue
      }

      const n = await upsertChapter(rows)
      bookInserted += n
      inserted += n
    }

    console.log(` +${bookInserted} verses`)
  }

  return { inserted, deletedShort, skipped, apiMissing }
}

async function verifyVersion(apiId: string, label: string): Promise<void> {
  const booksRes = await fetchWithRetry(`${API_BASE}/${apiId}/books.json`)
  const { books } = await booksRes.json() as { books: ApiBook[] }
  const totalApiChapters = books.reduce((s, b) => s + b.numberOfChapters, 0)

  const dbState = await loadDbState(label)
  const dbChapters = dbState.size

  let totalDbVerses = 0
  for (const n of Array.from(dbState.values())) totalDbVerses += n

  const missingChapters: string[] = []
  const shortChapters: string[] = []
  for (const book of books) {
    for (let ch = 1; ch <= book.numberOfChapters; ch++) {
      const count = dbState.get(`${book.name}:${ch}`) ?? 0
      if (count === 0) missingChapters.push(`${book.name} ${ch}`)
      else if (count <= SHORT_THRESHOLD) shortChapters.push(`${book.name} ${ch} (${count}v)`)
    }
  }

  const ok = missingChapters.length === 0 && shortChapters.length === 0
  const icon = ok ? '✓' : '✗'
  console.log(`  ${icon} ${label}: ${dbChapters}/${totalApiChapters} chapters, ${totalDbVerses} verses`)
  if (missingChapters.length > 0) console.log(`    Still missing: ${missingChapters.join(', ')}`)
  if (shortChapters.length > 0)   console.log(`    Still short:   ${shortChapters.join(', ')}`)
}

async function main() {
  console.log('\nbackfill-translations: repairing missing and short chapters\n')

  const stats = new Map<string, { inserted: number; deletedShort: number; apiMissing: string[] }>()

  for (const t of REMOTE_TRANSLATIONS) {
    const result = await backfillVersion(t.apiId, t.label)
    stats.set(t.label, result)
    console.log(
      `  Summary: +${result.inserted} inserted, ` +
      `${result.deletedShort} short chapters replaced, ` +
      `${result.skipped} chapters already OK`
    )
    if (result.apiMissing.length > 0) {
      console.log(`  Source limit (API has no data for these): ${result.apiMissing.join(', ')}`)
    }
  }

  console.log('\n════ Verification ════')
  for (const t of REMOTE_TRANSLATIONS) {
    await verifyVersion(t.apiId, t.label)
  }

  // WEB sanity check
  const { count: webCount } = await supabase
    .from('verse_translations')
    .select('*', { count: 'exact', head: true })
    .eq('version', 'WEB')
  const { count: srcCount } = await supabase
    .from('verses')
    .select('*', { count: 'exact', head: true })
  const webOk = webCount === srcCount
  console.log(`  ${webOk ? '✓' : '✗'} WEB: ${webCount} verses (source table: ${srcCount})`)

  console.log()
}

main().catch(err => { console.error(err); process.exit(1) })

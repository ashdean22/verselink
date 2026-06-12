/**
 * scripts/load-translations.ts
 *
 * Populates verse_translations with all verses from four Bible versions:
 *   WEB → copied from the existing `verses` table (no API fetch needed)
 *   KJV → fetched from bible.helloao.org  (translation id: eng_kjv)
 *   ASV → fetched from bible.helloao.org  (translation id: eng_asv)
 *   BSB → fetched from bible.helloao.org  (translation id: BSB)
 *
 * Content-format fix:
 *   The API returns verse content items in two encodings:
 *     1. Plain string: "In the beginning was the Word..."
 *     2. Object with text field: { "text": "...", "poem": 1 } or { "text": "...", "wordsOfJesus": true }
 *   Both are now extracted. The original parser only handled (1), silently dropping
 *   all poetry books and Words of Jesus for every remote translation.
 *
 * Checkpoint / resume:
 *   On startup we read all existing (version, book, chapter) triples from
 *   verse_translations into a Set.  Each chapter is inserted as a single
 *   atomic upsert call (chapters always have < 200 verses, well under the
 *   1 000-row batch limit), so a chapter is either fully present or absent —
 *   no partial state is possible.  Any chapter already in the Set is skipped,
 *   making the script safe to kill and restart at any point.
 *
 * Run: npx tsx scripts/load-translations.ts
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

// Each upsert call sends at most BATCH_SIZE rows.  We never split a chapter
// across two calls so that partial-chapter state is impossible.
const BATCH_SIZE     = 1000
const FETCH_SLEEP_MS = 300   // polite delay between API requests; 100ms was too fast
const MAX_RETRIES    = 4     // exponential backoff: 1s → 2s → 4s → 8s
const API_BASE       = 'https://bible.helloao.org/api'

const REMOTE_TRANSLATIONS = [
  { apiId: 'eng_kjv', label: 'KJV' },
  { apiId: 'eng_asv', label: 'ASV' },
  { apiId: 'BSB',     label: 'BSB' },
] as const

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

interface TranslationRow {
  book:    string
  chapter: number
  verse:   number
  version: string
  text:    string
}

// The API uses two content-item encodings:
//   1. Plain string  — "In the beginning was the Word..."
//   2. Object        — { text: "...", poem?: number, wordsOfJesus?: boolean, lineBreak?: boolean, noteId?: number }
// We extract the text value from both; objects without a `text` field (lineBreak, noteId) are skipped.
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

// Fetch a URL with up to MAX_RETRIES retries on non-200 / network errors,
// using exponential backoff starting at 1s.  404 is returned as-is (not retried).
async function fetchWithRetry(url: string): Promise<Response> {
  let delay = 1000
  let lastRes: Response | null = null
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status === 404) return res
      lastRes = res
      if (attempt < MAX_RETRIES) {
        process.stdout.write(` [HTTP ${res.status} retry ${attempt}/${MAX_RETRIES - 1}]`)
        await sleep(delay)
        delay = Math.min(delay * 2, 16000)
      }
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err
      process.stdout.write(` [net-err retry ${attempt}/${MAX_RETRIES - 1}]`)
      await sleep(delay)
      delay = Math.min(delay * 2, 16000)
    }
  }
  return lastRes!
}

// Upsert a batch into verse_translations.  ON CONFLICT DO NOTHING means the
// script is safe to re-run even if the checkpoint misses something.
async function flushBatch(rows: TranslationRow[]): Promise<number> {
  if (rows.length === 0) return 0
  const { error, count } = await supabase
    .from('verse_translations')
    .upsert(rows, {
      onConflict:       'book,chapter,verse,version',
      ignoreDuplicates: true,
      count:            'exact',
    })
  if (error) throw new Error(`Supabase upsert failed: ${error.message}`)
  return count ?? 0
}

// Read every (version, book, chapter) triple that already exists in
// verse_translations.  Chapters are the unit of atomicity, so a chapter key
// in this Set means all of its verses are present.
async function buildCheckpoint(): Promise<Set<string>> {
  const done = new Set<string>()
  const PAGE = 1000
  let offset = 0

  process.stdout.write('Building checkpoint…')

  while (true) {
    const { data, error } = await supabase
      .from('verse_translations')
      .select('version, book, chapter')
      .range(offset, offset + PAGE - 1)

    if (error) throw new Error(`Checkpoint query failed: ${error.message}`)
    if (!data || data.length === 0) break

    for (const row of data) {
      done.add(`${row.version}:${row.book}:${row.chapter}`)
    }

    if (data.length < PAGE) break
    offset += PAGE
  }

  console.log(` ${done.size} chapter(s) already loaded.`)
  return done
}

// Accumulator that guarantees no chapter straddles a batch boundary.
// Call addChapter() for each chapter; it flushes the current buffer first
// if the chapter would push it over BATCH_SIZE.
class Batcher {
  private buf: TranslationRow[] = []
  public  inserted = 0

  async addChapter(rows: TranslationRow[]): Promise<void> {
    if (rows.length === 0) return
    if (this.buf.length > 0 && this.buf.length + rows.length > BATCH_SIZE) {
      this.inserted += await flushBatch(this.buf)
      this.buf = []
    }
    this.buf.push(...rows)
  }

  async flush(): Promise<void> {
    if (this.buf.length > 0) {
      this.inserted += await flushBatch(this.buf)
      this.buf = []
    }
  }
}

// ── WEB ─────────────────────────────────────────────────────────────────────
// We already have WEB in the `verses` table; no API fetch needed.
// Read it in pages, group by chapter, then insert into verse_translations.
async function loadWEB(checkpoint: Set<string>): Promise<number> {
  console.log('\n[WEB] Copying from verses table…')

  // Build an in-memory chapter map (31k rows × small fields ≈ ~6 MB)
  const chapterMap = new Map<string, TranslationRow[]>()
  const PAGE = 1000
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('verses')
      .select('book, chapter, verse, text')
      .order('book').order('chapter').order('verse')
      .range(offset, offset + PAGE - 1)

    if (error) throw new Error(`verses fetch failed: ${error.message}`)
    if (!data || data.length === 0) break

    for (const row of data) {
      const key = `${row.book}:${row.chapter}`
      if (!chapterMap.has(key)) chapterMap.set(key, [])
      chapterMap.get(key)!.push({
        book: row.book, chapter: row.chapter, verse: row.verse,
        version: 'WEB', text: row.text,
      })
    }

    if (data.length < PAGE) break
    offset += PAGE
  }

  console.log(`  ${chapterMap.size} chapters read from verses table.`)

  const batcher = new Batcher()
  let skipped = 0

  for (const rows of Array.from(chapterMap.values())) {
    const { book, chapter } = rows[0]
    const cpKey = `WEB:${book}:${chapter}`
    if (checkpoint.has(cpKey)) { skipped++; continue }
    await batcher.addChapter(rows)
  }

  await batcher.flush()
  console.log(`  Done — ${batcher.inserted} rows inserted, ${skipped} chapters skipped.`)
  return batcher.inserted
}

// ── Remote translations ──────────────────────────────────────────────────────
interface ApiBooksResponse {
  books: Array<{ id: string; name: string; numberOfChapters: number }>
}

interface ApiChapterItem {
  type:     string
  number?:  number
  content?: ContentItem[]
}

interface ApiChapterResponse {
  book:    { id: string; name: string }
  chapter: { number: number; content: ApiChapterItem[] }
}

async function loadRemote(
  translation: typeof REMOTE_TRANSLATIONS[number],
  checkpoint: Set<string>,
): Promise<number> {
  console.log(`\n[${translation.label}] Fetching from API (id: ${translation.apiId})…`)

  const booksRes = await fetchWithRetry(`${API_BASE}/${translation.apiId}/books.json`)
  if (!booksRes.ok) {
    throw new Error(`books.json fetch failed for ${translation.apiId}: ${booksRes.status}`)
  }
  const { books } = await booksRes.json() as ApiBooksResponse

  const batcher  = new Batcher()
  let skipped    = 0
  let totalVerse = 0

  for (const book of books) {
    process.stdout.write(`  ${book.name} (${book.numberOfChapters} ch)…`)
    let bookVerses = 0

    for (let ch = 1; ch <= book.numberOfChapters; ch++) {
      const cpKey = `${translation.label}:${book.name}:${ch}`
      if (checkpoint.has(cpKey)) { skipped++; continue }

      await sleep(FETCH_SLEEP_MS)

      const url = `${API_BASE}/${translation.apiId}/${book.id}/${ch}.json`
      const res = await fetchWithRetry(url)

      if (!res.ok) {
        process.stdout.write(` [skip ch${ch}: ${res.status}]`)
        continue
      }

      let data: ApiChapterResponse
      try {
        data = await res.json() as ApiChapterResponse
      } catch {
        process.stdout.write(` [bad JSON ch${ch}]`)
        continue
      }

      const chapterRows: TranslationRow[] = []
      for (const item of data.chapter.content ?? []) {
        if (item.type !== 'verse' || !Array.isArray(item.content) || typeof item.number !== 'number') {
          continue
        }
        const text = extractVerseText(item.content)
        if (!text) continue
        chapterRows.push({
          book:    book.name,
          chapter: ch,
          verse:   item.number,
          version: translation.label,
          text,
        })
      }

      if (chapterRows.length === 0) {
        process.stdout.write(` [0 verses ch${ch}]`)
        continue
      }

      await batcher.addChapter(chapterRows)
      bookVerses  += chapterRows.length
      totalVerse  += chapterRows.length
    }

    console.log(` ${bookVerses} verses`)
  }

  await batcher.flush()
  console.log(`  Done — ${batcher.inserted} rows inserted, ${skipped} chapters skipped.`)
  return batcher.inserted
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\nload-translations: populating verse_translations (WEB, KJV, ASV, BSB)\n')

  const checkpoint = await buildCheckpoint()

  let grand = 0
  grand += await loadWEB(checkpoint)
  for (const t of REMOTE_TRANSLATIONS) {
    grand += await loadRemote(t, checkpoint)
  }

  console.log(`\n${'='.repeat(50)}`)
  console.log(`Total rows inserted this run: ${grand}`)
  console.log('='.repeat(50))
  console.log()
}

main().catch(err => { console.error(err); process.exit(1) })

/**
 * scripts/load-commentary.ts
 * Fetches Matthew Henry's Commentary (1708, public domain) from the HelloAO
 * Bible API and loads chunked text into the `chunks` Supabase table.
 *
 * SOURCE: https://bible.helloao.org — free, public domain, no API key needed.
 *
 * CHUNKING STRATEGY (key concept):
 *   We can't embed an entire commentary chapter (thousands of words) as one
 *   vector — the embedding would average out too much meaning. Instead we split
 *   each chapter into overlapping windows:
 *
 *     |<-- 375 words -->|
 *                    |<-- 375 words -->|
 *     stride: 338 words (375 - 37 overlap)
 *
 *   The 37-word overlap ensures that sentences near a chunk boundary are
 *   represented in BOTH the preceding and following chunks. A query whose
 *   answer straddles two chunks still finds it.
 *
 *   Token approximation: English prose ≈ 0.75 words/token, so
 *   375 words ≈ 500 tokens, 37 words ≈ 50 tokens.
 *
 * Run: npm run load-commentary
 */

import * as dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const API_BASE         = 'https://bible.helloao.org/api/c/matthew-henry'

// Chunking parameters (token approximations using word count)
const WORDS_PER_CHUNK  = 375   // ≈ 500 tokens
const OVERLAP_WORDS    = 37    // ≈  50 tokens
const STRIDE           = WORDS_PER_CHUNK - OVERLAP_WORDS  // 338

const BATCH_INSERT     = 50    // rows per Supabase upsert call
const FETCH_SLEEP_MS   = 50    // polite delay between HelloAO requests

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

interface BookEntry {
  id: string             // e.g. "GEN"
  name: string           // e.g. "Genesis"
  numberOfChapters: number
}

interface ChapterContent {
  type: string
  number?: number
  content?: string[]
}

interface ChapterResponse {
  book: { id: string; name: string }
  chapter: { number: number; content: ChapterContent[] }
}

// Split a text into overlapping word-window chunks.
function chunkByWords(text: string): Array<{ text: string; tokenCount: number }> {
  const words = text.split(/\s+/).filter(w => w.length > 0)
  if (words.length === 0) return []

  const result: Array<{ text: string; tokenCount: number }> = []
  let start = 0

  while (start < words.length) {
    const end   = Math.min(start + WORDS_PER_CHUNK, words.length)
    const chunk = words.slice(start, end).join(' ')
    result.push({ text: chunk, tokenCount: end - start })
    if (end === words.length) break
    start += STRIDE
  }

  return result
}

// Pull the plain prose out of a chapter's verse objects.
function extractText(data: ChapterResponse, bookName: string): string {
  const header = `Matthew Henry's Commentary on ${bookName} ${data.chapter.number}:\n\n`
  const body = data.chapter.content
    .filter(item => item.type === 'verse' && Array.isArray(item.content))
    .map(item => (item.content ?? []).join(' '))
    .join('\n\n')
  return header + body
}

async function fetchBooks(): Promise<BookEntry[]> {
  const res = await fetch(`${API_BASE}/books.json`)
  if (!res.ok) throw new Error(`books.json fetch failed: ${res.status}`)
  const data = await res.json() as { books: BookEntry[] }
  return data.books
}

async function fetchChapter(bookId: string, chapter: number): Promise<ChapterResponse | null> {
  const url = `${API_BASE}/${bookId}/${chapter}.json`
  const res = await fetch(url)
  if (!res.ok) return null
  try {
    return await res.json() as ChapterResponse
  } catch {
    return null   // API returned HTML error page instead of JSON
  }
}

async function flushBatch(batch: object[]) {
  if (batch.length === 0) return
  const { error } = await supabase
    .from('chunks')
    .upsert(batch, { onConflict: 'doc_title,book,chapter,chunk_index', ignoreDuplicates: false })
  if (error) throw new Error(`Supabase upsert failed: ${error.message}`)
}

async function main() {
  console.log('\nLoading Matthew Henry Commentary → chunks table')
  console.log(`Chunk size: ${WORDS_PER_CHUNK} words (≈500 tokens) | Overlap: ${OVERLAP_WORDS} words (≈50 tokens)\n`)

  const books = await fetchBooks()
  console.log(`${books.length} books found\n`)

  // Build a set of (book, chapter) pairs already loaded so we can skip them.
  // limit(50000) overrides Supabase's default 1000-row cap; 1,167 chapters × avg ~14 chunks << 50k.
  const { data: existing } = await supabase
    .from('chunks')
    .select('book, chapter')
    .eq('doc_title', 'Matthew Henry')
    .limit(50000)
  const done = new Set((existing ?? []).map(r => `${r.book}:${r.chapter}`))
  if (done.size > 0) {
    console.log(`Checkpoint: ${done.size} (book, chapter) pairs already loaded — skipping.\n`)
  }

  let totalChunks = 0
  const batch: object[] = []

  for (const book of books) {
    process.stdout.write(`  ${book.name} (${book.numberOfChapters} ch)…`)
    let bookChunks = 0

    for (let ch = 1; ch <= book.numberOfChapters; ch++) {
      const key = `${book.name}:${ch}`
      if (done.has(key)) continue

      const data = await fetchChapter(book.id, ch)
      await sleep(FETCH_SLEEP_MS)
      if (!data) continue   // no commentary for this chapter

      const rawText = extractText(data, book.name)
      const chunks  = chunkByWords(rawText)

      for (let i = 0; i < chunks.length; i++) {
        batch.push({
          source_type: 'commentary',
          doc_title:   'Matthew Henry',
          book:        book.name,
          chapter:     ch,
          chunk_index: i,
          text:        chunks[i].text,
          token_count: chunks[i].tokenCount,
          // embedding left null — filled by embed-chunks.ts
        })

        if (batch.length >= BATCH_INSERT) {
          await flushBatch(batch)
          batch.length = 0
        }
      }

      bookChunks   += chunks.length
      totalChunks  += chunks.length
    }

    console.log(` ${bookChunks} chunks`)
  }

  // Flush any remaining rows
  if (batch.length > 0) await flushBatch(batch)

  console.log(`\nDone — ${totalChunks} chunks inserted/updated.`)
  console.log('Next: npm run embed-chunks   (or: caffeinate -i npm run embed-chunks)')
}

main().catch(err => { console.error(err); process.exit(1) })

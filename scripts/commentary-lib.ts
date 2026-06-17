/**
 * scripts/commentary-lib.ts
 * Shared helpers for every commentary loader (HelloAO + custom scrapers).
 *
 * All commentaries share the SAME downstream pipeline:
 *   raw chapter prose → overlapping word-window chunks → chunks table → embed.
 * Only the *fetching/parsing* differs per source, so that part lives in the
 * individual loader scripts; everything common lives here.
 *
 * CHUNKING STRATEGY (key concept):
 *   We can't embed a whole commentary chapter (thousands of words) as one vector
 *   — the meaning averages out. Instead we split each chapter into overlapping
 *   windows:
 *
 *     |<-- 375 words -->|
 *                    |<-- 375 words -->|
 *     stride: 338 words (375 - 37 overlap)
 *
 *   The 37-word overlap means a sentence near a boundary appears in BOTH chunks,
 *   so a query whose answer straddles two chunks still finds it.
 *   Token approximation: English prose ≈ 0.75 words/token →
 *   375 words ≈ 500 tokens, 37 words ≈ 50 tokens.
 */

import * as dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing Supabase env vars — check .env.local')
  process.exit(1)
}

export const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

// Chunking parameters (token approximations using word count)
export const WORDS_PER_CHUNK = 375   // ≈ 500 tokens
export const OVERLAP_WORDS   = 37    // ≈  50 tokens
export const STRIDE          = WORDS_PER_CHUNK - OVERLAP_WORDS  // 338

export const BATCH_INSERT    = 50    // rows per Supabase upsert call

export type Tradition = 'reformed' | 'arminian' | 'evangelical' | 'puritan' | 'catholic'

export interface CommentaryMeta {
  docTitle:  string      // e.g. "John Calvin" — stored verbatim, shown in the UI
  tradition: Tradition
}

export function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

// Split a text into overlapping word-window chunks.
export function chunkByWords(text: string): Array<{ text: string; tokenCount: number }> {
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

export interface ChunkRow {
  source_type: string
  doc_title:   string
  tradition:   Tradition
  book:        string
  chapter:     number
  chunk_index: number
  text:        string
  token_count: number
}

// Upsert a batch keyed on the (doc_title, book, chapter, chunk_index) unique index.
export async function flushBatch(batch: ChunkRow[]) {
  if (batch.length === 0) return
  const { error } = await supabase
    .from('chunks')
    .upsert(batch, { onConflict: 'doc_title,book,chapter,chunk_index', ignoreDuplicates: false })
  if (error) throw new Error(`Supabase upsert failed: ${error.message}`)
}

// Build chunk rows for one chapter of one commentary.
export function rowsForChapter(
  meta: CommentaryMeta,
  book: string,
  chapter: number,
  rawText: string,
): ChunkRow[] {
  const chunks = chunkByWords(rawText)
  return chunks.map((c, i) => ({
    source_type: 'commentary',
    doc_title:   meta.docTitle,
    tradition:   meta.tradition,
    book,
    chapter,
    chunk_index: i,
    text:        c.text,
    token_count: c.tokenCount,
    // embedding left null — filled by embed-chunks.ts
  }))
}

// Which (book, chapter) pairs are already loaded for this commentary — so a
// re-run resumes instead of re-fetching everything (checkpointing).
export async function loadedChapters(docTitle: string): Promise<Set<string>> {
  const { data } = await supabase
    .from('chunks')
    .select('book, chapter')
    .eq('doc_title', docTitle)
    .limit(50000)   // override Supabase's default 1000-row cap
  return new Set((data ?? []).map(r => `${r.book}:${r.chapter}`))
}

// Final count of rows for this commentary (for the "verify row counts" step).
export async function countRows(docTitle: string): Promise<number> {
  const { count } = await supabase
    .from('chunks')
    .select('*', { count: 'exact', head: true })
    .eq('doc_title', docTitle)
  return count ?? 0
}

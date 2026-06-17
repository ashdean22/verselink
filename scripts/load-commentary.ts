/**
 * scripts/load-commentary.ts
 * Loads a public-domain commentary from the HelloAO Bible API into the `chunks`
 * table, tagged with its doc_title + tradition. One source per run.
 *
 * SOURCE: https://bible.helloao.org — free, public domain, no API key needed.
 *
 * Usage:
 *   npm run load-commentary -- <key>
 *   where <key> ∈ matthew-henry | john-gill | adam-clarke | jamieson-fausset-brown
 *
 * Calvin (Reformed) and Haydock (Catholic) are NOT on HelloAO — they have their
 * own scrapers: scripts/load-calvin.ts and scripts/load-haydock.ts.
 *
 * Run: npm run load-commentary -- john-gill
 */

import {
  CommentaryMeta, ChunkRow,
  BATCH_INSERT, sleep, flushBatch, rowsForChapter, loadedChapters, countRows,
} from './commentary-lib'

const FETCH_SLEEP_MS = 50    // polite delay between HelloAO requests

// Registry of HelloAO commentaries we ingest. apiId is the HelloAO path segment.
const HELLOAO: Record<string, CommentaryMeta & { apiId: string }> = {
  'matthew-henry':          { apiId: 'matthew-henry',          docTitle: 'Matthew Henry',          tradition: 'puritan'     },
  'john-gill':              { apiId: 'john-gill',              docTitle: 'John Gill',              tradition: 'reformed'    },
  'adam-clarke':            { apiId: 'adam-clarke',            docTitle: 'Adam Clarke',            tradition: 'arminian'    },
  'jamieson-fausset-brown': { apiId: 'jamieson-fausset-brown', docTitle: 'Jamieson-Fausset-Brown', tradition: 'evangelical' },
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

// Pull the plain prose out of a chapter's verse objects.
function extractText(data: ChapterResponse, docTitle: string, bookName: string): string {
  const header = `${docTitle}'s Commentary on ${bookName} ${data.chapter.number}:\n\n`
  const body = data.chapter.content
    .filter(item => item.type === 'verse' && Array.isArray(item.content))
    .map(item => (item.content ?? []).join(' '))
    .join('\n\n')
  return header + body
}

async function fetchBooks(apiBase: string): Promise<BookEntry[]> {
  const res = await fetch(`${apiBase}/books.json`)
  if (!res.ok) throw new Error(`books.json fetch failed: ${res.status}`)
  const data = await res.json() as { books: BookEntry[] }
  return data.books
}

async function fetchChapter(apiBase: string, bookId: string, chapter: number): Promise<ChapterResponse | null> {
  const res = await fetch(`${apiBase}/${bookId}/${chapter}.json`)
  if (!res.ok) return null
  try {
    return await res.json() as ChapterResponse
  } catch {
    return null   // API returned HTML error page instead of JSON
  }
}

async function main() {
  const key = process.argv[2]
  if (!key || !HELLOAO[key]) {
    console.error(`Usage: npm run load-commentary -- <key>`)
    console.error(`  key ∈ ${Object.keys(HELLOAO).join(' | ')}`)
    process.exit(1)
  }

  const meta    = HELLOAO[key]
  const apiBase = `https://bible.helloao.org/api/c/${meta.apiId}`

  console.log(`\nLoading ${meta.docTitle} (${meta.tradition}) → chunks table`)
  console.log(`Source: ${apiBase}\n`)

  const books = await fetchBooks(apiBase)
  console.log(`${books.length} books found`)

  const done = await loadedChapters(meta.docTitle)
  if (done.size > 0) console.log(`Checkpoint: ${done.size} (book, chapter) pairs already loaded — skipping.`)
  console.log('')

  let totalChunks = 0
  const batch: ChunkRow[] = []

  for (const book of books) {
    process.stdout.write(`  ${book.name} (${book.numberOfChapters} ch)…`)
    let bookChunks = 0

    for (let ch = 1; ch <= book.numberOfChapters; ch++) {
      if (done.has(`${book.name}:${ch}`)) continue

      const data = await fetchChapter(apiBase, book.id, ch)
      await sleep(FETCH_SLEEP_MS)
      if (!data) continue   // no commentary for this chapter

      const rawText = extractText(data, meta.docTitle, book.name)
      const rows    = rowsForChapter(meta, book.name, ch, rawText)

      for (const row of rows) {
        batch.push(row)
        if (batch.length >= BATCH_INSERT) {
          await flushBatch(batch)
          batch.length = 0
        }
      }

      bookChunks  += rows.length
      totalChunks += rows.length
    }

    console.log(` ${bookChunks} chunks`)
  }

  if (batch.length > 0) await flushBatch(batch)

  const total = await countRows(meta.docTitle)
  console.log(`\nDone — ${totalChunks} chunks inserted/updated this run.`)
  console.log(`Row count for ${meta.docTitle}: ${total}`)
  console.log('Next: npm run embed-chunks   (or: caffeinate -i npm run embed-chunks)')
}

main().catch(err => { console.error(err); process.exit(1) })

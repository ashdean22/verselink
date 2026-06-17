/**
 * scripts/load-haydock.ts
 * Loads Haydock's Catholic Bible Commentary (1859, Catholic) into the `chunks`
 * table.
 *
 * SOURCE: BibleHub's reprint of the public-domain Haydock commentary, organised
 *   one HTML page per book/chapter:
 *     https://biblehub.com/commentaries/haydock/<book>/<chapter>.htm
 *   The chapter commentary lives in a <div class="chap"> block. Haydock itself
 *   is public domain; we only ingest that public-domain text.
 *
 * PARSING STRATEGY:
 *   Pull the <div class="chap"> body (balanced-div extraction so nested ad/nav
 *   divs don't truncate it), drop scripts/ads, strip tags → plain prose, then
 *   run the same word-window chunker as every other commentary.
 *
 * Run: npm run load-haydock
 */

import { BIBLE_BOOKS } from '../lib/bible-books'
import {
  CommentaryMeta, ChunkRow,
  BATCH_INSERT, sleep, flushBatch, rowsForChapter, loadedChapters, countRows,
} from './commentary-lib'

const META: CommentaryMeta = { docTitle: 'Haydock', tradition: 'catholic' }
const FETCH_SLEEP_MS = 250   // polite delay between BibleHub requests
const USER_AGENT     = 'Mozilla/5.0 (compatible; VerseLink/1.0; commentary ingest)'

// BibleHub slug = lowercase + underscores, with a couple of overrides.
const SLUG_OVERRIDE: Record<string, string> = {
  'Song of Solomon': 'songs',
}
function biblehubSlug(name: string): string {
  return SLUG_OVERRIDE[name] ?? name.toLowerCase().replace(/ /g, '_')
}

// Extract the inner HTML of the first <div class="chap"> using brace-style div
// counting, so nested <div> (ads, nav) inside it don't cut the match short.
function extractChapDiv(html: string): string | null {
  const open = html.search(/<div class="chap"[^>]*>/)
  if (open < 0) return null
  const startTag = html.match(/<div class="chap"[^>]*>/)![0]
  let i = open + startTag.length
  let depth = 1
  const body: string[] = []
  const tagRe = /<\/?div\b[^>]*>/g
  tagRe.lastIndex = i

  let m: RegExpExecArray | null
  let last = i
  while ((m = tagRe.exec(html)) !== null) {
    body.push(html.slice(last, m.index))
    if (m[0].startsWith('</div')) {
      depth--
      if (depth === 0) return body.join('')
    } else {
      depth++
    }
    last = tagRe.lastIndex
  }
  return body.join('')   // unbalanced — return what we have
}

// HTML → plain prose.
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<ins[\s\S]*?<\/ins>/gi, ' ')         // adsbygoogle
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#?[a-z0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    // Drop BibleHub's trailing attribution boilerplate (not Haydock's text).
    .replace(/Haydock Catholic Bible Commentary Text Courtesy of[\s\S]*$/i, '')
    .trim()
}

async function fetchChapter(slug: string, chapter: number): Promise<string | null> {
  const url = `https://biblehub.com/commentaries/haydock/${slug}/${chapter}.htm`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) return null
  const html = await res.text()
  const chap = extractChapDiv(html)
  if (!chap) return null
  const text = htmlToText(chap)
  return text.length > 80 ? text : null
}

async function main() {
  console.log(`\nLoading ${META.docTitle} (${META.tradition}) → chunks table`)
  console.log(`Source: BibleHub (public-domain Haydock 1859)\n`)

  const done = await loadedChapters(META.docTitle)
  if (done.size > 0) console.log(`Checkpoint: ${done.size} (book, chapter) pairs already loaded — skipping.\n`)

  let totalChunks = 0
  const batch: ChunkRow[] = []

  for (const book of BIBLE_BOOKS) {
    process.stdout.write(`  ${book.name} (${book.chapters} ch)…`)
    const slug = biblehubSlug(book.name)
    let bookChunks = 0

    for (let ch = 1; ch <= book.chapters; ch++) {
      if (done.has(`${book.name}:${ch}`)) continue

      const text = await fetchChapter(slug, ch)
      await sleep(FETCH_SLEEP_MS)
      if (!text) continue

      const header = `Haydock's Catholic Commentary on ${book.name} ${ch}:\n\n`
      const rows   = rowsForChapter(META, book.name, ch, header + text)

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

  const total = await countRows(META.docTitle)
  console.log(`\nDone — ${totalChunks} chunks inserted/updated this run.`)
  console.log(`Row count for ${META.docTitle}: ${total}`)
  console.log('Next: npm run embed-chunks   (or: caffeinate -i npm run embed-chunks)')
}

main().catch(err => { console.error(err); process.exit(1) })

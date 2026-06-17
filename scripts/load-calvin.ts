/**
 * scripts/load-calvin.ts
 * Loads John Calvin's Commentaries (Reformed) into the `chunks` table.
 *
 * SOURCE: Christian Classics Ethereal Library (CCEL), public domain, in
 *   Theological Markup Language (ThML/XML): https://ccel.org/ccel/c/calvin/calcomNN.xml
 *   The series spans 45 volumes (calcom01..calcom45). Calvin never wrote on the
 *   whole Bible, so coverage is partial and uneven — that's expected.
 *
 * PARSING STRATEGY:
 *   ThML marks each chapter section with
 *     <div2 type="scripture" title="Genesis 1:1-31"> … </div2>
 *   The title gives us book + chapter; the inner text is the passage plus
 *   Calvin's commentary. We strip tags + editor footnotes, then run the SAME
 *   word-window chunker every other commentary uses (commentary-lib.ts).
 *
 * Run: npm run load-calvin
 */

import {
  CommentaryMeta, ChunkRow,
  BATCH_INSERT, sleep, flushBatch, rowsForChapter, loadedChapters, countRows,
} from './commentary-lib'

const META: CommentaryMeta = { docTitle: 'John Calvin', tradition: 'reformed' }
const MAX_VOLUME     = 45
const FETCH_SLEEP_MS = 300   // be polite — these files are ~1-2 MB each

// A few CCEL book names differ from the canonical names used elsewhere.
const BOOK_NORMALIZE: Record<string, string> = {
  'Psalm': 'Psalms',
  'Canticles': 'Song of Solomon',
  'Song of Songs': 'Song of Solomon',
  'Heb': 'Hebrews',   // vol 44 titles use the "Heb 1:1" abbreviation
}

function normalizeBook(name: string): string {
  const trimmed = name.trim()
  return BOOK_NORMALIZE[trimmed] ?? trimmed
}

// Strip ThML down to plain prose: drop editor footnotes, then all tags + entities.
function stripThml(s: string): string {
  return s
    .replace(/<note[\s\S]*?<\/note>/gi, ' ')   // editor footnotes (often Latin asides)
    .replace(/<[^>]+>/g, ' ')                   // all remaining tags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#?[a-z0-9]+;/gi, ' ')            // any other entities → space
    .replace(/\s+/g, ' ')
    .trim()
}

// Parse a volume's XML into a map of "Book:Chapter" → aggregated chapter text.
//
// Calvin's ThML is wildly inconsistent across the 45 volumes — the passage
// markers vary in div LEVEL, attribute CASE, and attribute ORDER:
//   <div2 type="scripture" title="Genesis 1:1-31">   (vol 1)
//   <div2 type="Scripture" title="Jeremiah 30:1-3">  (vol 20)
//   <div3 type="Scripture" title="Zechariah 1:1-3">  (vol 30)
//   <div2 title="Luke 1:1-4" type="scripture">       (Gospel harmony, vol 31-33)
// So we scan for the OPENING tags directly (any order/case/level), then slice
// each block's text up to the next closing tag at the same level. Scripture
// divs are leaf content (no nested div2/div3), so the next same-level close is
// always this block's own close — which also sidesteps the case where a
// type="Chapter" div2 *contains* the div3 scripture blocks.
function parseVolume(xml: string): Map<string, { book: string; chapter: number; text: string }> {
  const out = new Map<string, { book: string; chapter: number; text: string }>()

  // Opening tags for scripture sections, regardless of attribute order/case.
  const openRe = /<(div[23])\b[^>]*\btype="[Ss]cripture"[^>]*>/g
  let m: RegExpExecArray | null

  while ((m = openRe.exec(xml)) !== null) {
    const level   = m[1]               // "div2" | "div3"
    const openTag = m[0]

    // \btitle= avoids matching shorttitle="…"
    const titleMatch = openTag.match(/\btitle="([^"]+)"/)
    if (!titleMatch) continue

    // "Genesis 1:1-31" / "Luke 1:1-4" → book + chapter
    const t = titleMatch[1].match(/^(.+?)\s+(\d+):/)
    if (!t) continue
    const book    = normalizeBook(t[1])
    const chapter = parseInt(t[2], 10)
    if (!Number.isFinite(chapter)) continue

    const start = m.index + openTag.length
    const close = xml.indexOf(`</${level}>`, start)
    if (close < 0) continue

    const text = stripThml(xml.slice(start, close))
    if (text.length < 50) continue   // skip empty/near-empty sections

    const key = `${book}:${chapter}`
    const prev = out.get(key)
    // A chapter usually spans many per-verse blocks — concatenate them.
    if (prev) prev.text += '\n\n' + text
    else out.set(key, { book, chapter, text })
  }

  return out
}

async function fetchVolume(n: number): Promise<string | null> {
  const vol = String(n).padStart(2, '0')
  const url = `https://ccel.org/ccel/c/calvin/calcom${vol}.xml`
  const res = await fetch(url)
  if (!res.ok) return null
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('xml')) return null   // got an HTML error page
  return await res.text()
}

async function main() {
  console.log(`\nLoading ${META.docTitle} (${META.tradition}) → chunks table`)
  console.log(`Source: CCEL ThML, volumes calcom01..calcom${MAX_VOLUME}\n`)

  const done = await loadedChapters(META.docTitle)
  if (done.size > 0) console.log(`Checkpoint: ${done.size} (book, chapter) pairs already loaded — skipping.\n`)

  // PASS 1 — aggregate across ALL volumes first. Calvin's harmonies (the
  // Pentateuch "Harmony of the Law" and the Gospel "Harmony of the Evangelists")
  // place the same book:chapter in MULTIPLE volumes, so we must merge them into
  // one text per chapter BEFORE chunking. Doing this per-volume would produce
  // duplicate (book, chapter, chunk_index) keys and break the upsert.
  const merged = new Map<string, { book: string; chapter: number; text: string }>()

  for (let v = 1; v <= MAX_VOLUME; v++) {
    process.stdout.write(`  Volume ${String(v).padStart(2, '0')}…`)
    const xml = await fetchVolume(v)
    await sleep(FETCH_SLEEP_MS)
    if (!xml) { console.log(' (not found)'); continue }

    const chapters = parseVolume(xml)
    for (const { book, chapter, text } of chapters.values()) {
      const key  = `${book}:${chapter}`
      const prev = merged.get(key)
      if (prev) prev.text += '\n\n' + text
      else merged.set(key, { book, chapter, text })
    }
    console.log(` ${chapters.size} chapters`)
  }

  // PASS 2 — chunk + insert each chapter once.
  console.log(`\nMerged into ${merged.size} unique (book, chapter) chapters. Inserting…`)
  let totalChunks = 0
  const batch: ChunkRow[] = []

  for (const { book, chapter, text } of merged.values()) {
    if (done.has(`${book}:${chapter}`)) continue

    const header = `John Calvin's Commentary on ${book} ${chapter}:\n\n`
    const rows   = rowsForChapter(META, book, chapter, header + text)

    for (const row of rows) {
      batch.push(row)
      if (batch.length >= BATCH_INSERT) {
        await flushBatch(batch)
        batch.length = 0
      }
    }
    totalChunks += rows.length
  }

  if (batch.length > 0) await flushBatch(batch)

  const total = await countRows(META.docTitle)
  console.log(`\nDone — ${totalChunks} chunks inserted/updated this run.`)
  console.log(`Row count for ${META.docTitle}: ${total}`)
  console.log('Next: npm run embed-chunks   (or: caffeinate -i npm run embed-chunks)')
}

main().catch(err => { console.error(err); process.exit(1) })

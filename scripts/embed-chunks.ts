/**
 * scripts/embed-chunks.ts
 * Embeds every row in the `chunks` table that is missing an embedding vector.
 * Identical resilience pattern to embed-bible.ts: checkpoint, retry, circuit breaker.
 *
 * Run: npm run embed-chunks
 * Prevent Mac sleep: caffeinate -i npm run embed-chunks
 *
 * Estimated time: ~8,000 chunks × ~420ms avg → ~55 min with billing enabled.
 */

import * as dotenv from 'dotenv'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

const GEMINI_API_KEY   = process.env.GEMINI_API_KEY!
const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const BATCH_FETCH              = 300
const LOG_EVERY                = 100
const MAX_RETRIES              = 5
// CONCURRENCY (key concept): the bottleneck is network round-trips to the Gemini
// embedding API (~300-400ms each), not CPU. Running them one-at-a-time wastes that
// wait. We fire CONCURRENCY requests in flight at once via a worker pool, which
// cuts a 60k-chunk run from hours to ~30 min. Kept modest to stay under the
// embedding RPM limit; embedWithRetry backs off on any 429s.
const CONCURRENCY             = 12

if (!GEMINI_API_KEY || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing required env vars — check .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
const embeddingModel = genAI.getGenerativeModel(
  { model: 'gemini-embedding-001' },
  { apiVersion: 'v1' }
)

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

async function embedWithRetry(text: string): Promise<number[] | null> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await embeddingModel.embedContent({
        content: { parts: [{ text }], role: 'user' },
        // @ts-expect-error outputDimensionality valid but missing from older SDK types
        outputDimensionality: 768,
      })
      return result.embedding.values
    } catch {
      if (attempt === MAX_RETRIES) return null
      await sleep(Math.pow(2, attempt) * 1000)
    }
  }
  return null
}

async function main() {
  const { count: totalNull } = await supabase
    .from('chunks')
    .select('*', { count: 'exact', head: true })
    .is('embedding', null)

  if (!totalNull) {
    console.log('All chunks already embedded. Nothing to do.')
    return
  }

  const total = totalNull   // non-null after the guard above; stable inside closures

  console.log(`\nEmbedding ${total} commentary chunks (all sources missing an embedding)`)
  console.log(`Model: gemini-embedding-001 | Dims: 768 | Concurrency: ${CONCURRENCY}\n`)

  let totalDone   = 0
  let errors      = 0

  // Fetch the next batch of un-embedded chunks, retrying transient network
  // failures (Supabase/undici can throw "TypeError: terminated" on a blip).
  // Over a 60k-row run these are common; a single blip must NOT kill the job.
  async function fetchBatchWithRetry(): Promise<Array<{ id: number; text: string }> | null> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const { data, error } = await supabase
          .from('chunks')
          .select('id, text')
          .is('embedding', null)
          .order('id', { ascending: true })
          .limit(BATCH_FETCH)
        if (error) throw new Error(error.message)
        return (data ?? []) as Array<{ id: number; text: string }>
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        process.stdout.write(`\n  [fetch retry ${attempt}/${MAX_RETRIES}] ${msg}`)
        if (attempt === MAX_RETRIES) return null
        await sleep(Math.pow(2, attempt) * 1000)
      }
    }
    return null
  }

  // Write one embedding, retrying transient network failures so a blip leaves the
  // chunk NULL (picked up next loop) rather than crashing the run.
  async function writeEmbedding(id: number, vector: number[]): Promise<boolean> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const { error } = await supabase
          .from('chunks')
          .update({ embedding: JSON.stringify(vector) })
          .eq('id', id)
        if (error) throw new Error(error.message)
        return true
      } catch (err) {
        if (attempt === MAX_RETRIES) {
          const msg = err instanceof Error ? err.message : String(err)
          process.stdout.write(`\n  [SKIP write] chunk ${id}: ${msg}`)
          return false
        }
        await sleep(Math.pow(2, attempt) * 1000)
      }
    }
    return false
  }

  let stallBatches = 0   // consecutive batches that embedded nothing new

  while (true) {
    const chunks = await fetchBatchWithRetry()
    if (chunks === null) {
      console.error('\nBatch fetch failed after retries — pausing 60s then continuing.')
      await sleep(60 * 1000)
      continue
    }
    if (chunks.length === 0) break

    // If a batch embeds nothing, the same NULL rows will be re-fetched forever.
    // Bail after two such batches so a permanently-bad chunk can't hang the run.
    const doneBefore = totalDone

    // Worker pool: CONCURRENCY workers pull from a shared cursor over the batch,
    // each embedding + writing one chunk at a time. No fixed sleep — throughput
    // comes from parallelism, and embedWithRetry handles any rate-limit backoff.
    const items = chunks   // non-null array; stable inside the worker closure
    let cursor = 0
    async function worker() {
      while (cursor < items.length) {
        const chunk = items[cursor++]
        const vector = await embedWithRetry(chunk.text)
        if (!vector) {
          errors++
          process.stdout.write(`\n  [SKIP] chunk ${chunk.id} failed after ${MAX_RETRIES} retries`)
          continue
        }
        const wrote = await writeEmbedding(chunk.id, vector)
        if (!wrote) { errors++; continue }

        totalDone++
        if (totalDone % LOG_EVERY === 0) {
          const pct = Math.round((totalDone / total) * 100)
          process.stdout.write(`\r  Embedded ${totalDone}/${total} (${pct}%) | skipped: ${errors}   `)
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

    if (totalDone === doneBefore) {
      stallBatches++
      if (stallBatches >= 2) {
        console.error(`\nNo progress across ${stallBatches} batches — ${chunks.length} chunks keep failing. Stopping.`)
        break
      }
    } else {
      stallBatches = 0
    }
  }

  console.log(`\n\nDone! Embedded ${totalDone} chunks. Skipped: ${errors}.`)
  if (errors > 0) console.log('Re-run to retry skipped chunks (checkpoint is safe).')
}

main().catch(err => { console.error(err); process.exit(1) })

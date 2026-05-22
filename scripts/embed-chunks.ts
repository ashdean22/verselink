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

const BATCH_FETCH              = 200
const SLEEP_MS                 = 120
const LOG_EVERY                = 100
const MAX_RETRIES              = 5
const CIRCUIT_BREAK_THRESHOLD  = 10

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

  console.log(`\nEmbedding ${totalNull} commentary chunks — Matthew Henry`)
  console.log(`Model: gemini-embedding-001 | Dims: 768 | Sleep: ${SLEEP_MS}ms\n`)

  let totalDone   = 0
  let errors      = 0
  let consecutive = 0

  while (true) {
    const { data: chunks, error: fetchErr } = await supabase
      .from('chunks')
      .select('id, text')
      .is('embedding', null)
      .order('id', { ascending: true })
      .limit(BATCH_FETCH)

    if (fetchErr) { console.error('Fetch error:', fetchErr.message); process.exit(1) }
    if (!chunks || chunks.length === 0) break

    for (const chunk of chunks) {
      const vector = await embedWithRetry(chunk.text)

      if (!vector) {
        errors++
        consecutive++
        process.stdout.write(`\n  [SKIP] chunk ${chunk.id} failed after ${MAX_RETRIES} retries`)

        if (consecutive >= CIRCUIT_BREAK_THRESHOLD) {
          console.log(`\n  Circuit breaker tripped. Pausing 2 min…`)
          await sleep(2 * 60 * 1000)
          consecutive = 0
        }
        continue
      }

      consecutive = 0

      const { error: updateErr } = await supabase
        .from('chunks')
        .update({ embedding: JSON.stringify(vector) })
        .eq('id', chunk.id)

      if (updateErr) {
        console.error(`\n  DB write failed for chunk ${chunk.id}: ${updateErr.message}`)
        errors++
        continue
      }

      totalDone++
      if (totalDone % LOG_EVERY === 0) {
        const pct = Math.round((totalDone / totalNull) * 100)
        process.stdout.write(`\r  Embedded ${totalDone}/${totalNull} (${pct}%) | skipped: ${errors}   `)
      }

      await sleep(SLEEP_MS)
    }
  }

  console.log(`\n\nDone! Embedded ${totalDone} chunks. Skipped: ${errors}.`)
  if (errors > 0) console.log('Re-run to retry skipped chunks (checkpoint is safe).')
}

main().catch(err => { console.error(err); process.exit(1) })

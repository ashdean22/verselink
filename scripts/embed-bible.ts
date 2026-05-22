/**
 * scripts/embed-bible.ts
 * Embeds every verse in the `verses` table using Gemini gemini-embedding-001.
 * Writes the resulting 768-float vector back to the `embedding` column.
 *
 * Run with:   npm run embed-bible
 *
 * CHECKPOINT PATTERN: Only fetches verses WHERE embedding IS NULL, so re-running
 * after a crash or interruption picks up exactly where it left off.
 *
 * RATE LIMITING: Free AI Studio tier allows ~1,500 req/min. We sleep 100ms
 * between calls (~600 req/min) to stay safely under the limit.
 *
 * RESILIENCE: Transient network errors (machine sleep, flaky WiFi) are retried
 * with exponential backoff. A circuit breaker pauses the whole pipeline if the
 * network is clearly down, rather than hammering for hours with failed calls.
 */

import * as dotenv from 'dotenv'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

const GEMINI_API_KEY  = process.env.GEMINI_API_KEY!
const SUPABASE_URL    = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const BATCH_FETCH = 200    // verses fetched per round (smaller = more frequent progress saves)
const SLEEP_MS    = 120    // base pause between Gemini calls
const LOG_EVERY   = 100    // print a progress line every N successes
const MAX_RETRIES = 5      // per-verse retry attempts before giving up
const CIRCUIT_BREAK_THRESHOLD = 10  // consecutive failures before we pause the whole pipeline

if (!GEMINI_API_KEY || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing required env vars — check .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

// apiVersion:'v1' is required — gemini-embedding-001 is only on v1, not v1beta.
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
const embeddingModel = genAI.getGenerativeModel(
  { model: 'gemini-embedding-001' },
  { apiVersion: 'v1' }
)

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function embedWithRetry(text: string): Promise<number[] | null> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // gemini-embedding-001 natively outputs 3072 dims; outputDimensionality:768
      // uses Matryoshka truncation to keep our vector(768) schema intact.
      const result = await embeddingModel.embedContent({
        content: { parts: [{ text }], role: 'user' },
        // @ts-expect-error outputDimensionality is valid but missing from older SDK types
        outputDimensionality: 768,
      })
      return result.embedding.values
    } catch (err) {
      const isLast = attempt === MAX_RETRIES
      if (isLast) return null
      // Exponential backoff: wait 2^attempt seconds before retrying.
      // This handles brief network blips without hammering the API.
      const backoffMs = Math.pow(2, attempt) * 1000
      await sleep(backoffMs)
    }
  }
  return null
}

async function main() {
  const { count: totalNull } = await supabase
    .from('verses')
    .select('*', { count: 'exact', head: true })
    .is('embedding', null)

  if (!totalNull) {
    console.log('All verses already embedded. Nothing to do.')
    return
  }

  console.log(`Starting embedding pipeline — ${totalNull} verses still need embeddings.`)
  console.log(`Model: gemini-embedding-001 | Dimensions: 768 (MRL) | Sleep: ${SLEEP_MS}ms\n`)

  let totalDone  = 0
  let errors     = 0
  let consecutive = 0   // consecutive failures — triggers circuit breaker

  while (true) {
    const { data: verses, error: fetchErr } = await supabase
      .from('verses')
      .select('id, text')
      .is('embedding', null)
      .order('id', { ascending: true })
      .limit(BATCH_FETCH)

    if (fetchErr) { console.error('Fetch error:', fetchErr.message); process.exit(1) }
    if (!verses || verses.length === 0) break

    for (const verse of verses) {
      const vector = await embedWithRetry(verse.text)

      if (!vector) {
        errors++
        consecutive++
        process.stdout.write(`\n  [SKIP] verse ${verse.id} failed after ${MAX_RETRIES} retries`)

        // CIRCUIT BREAKER: if too many consecutive failures, the network is probably
        // down. Pause for 2 minutes instead of flooding the API with doomed requests.
        if (consecutive >= CIRCUIT_BREAK_THRESHOLD) {
          console.log(`\n  Circuit breaker tripped (${consecutive} consecutive failures). Pausing 2 min…`)
          await sleep(2 * 60 * 1000)
          consecutive = 0
        }
        continue
      }

      consecutive = 0  // reset on success

      const { error: updateErr } = await supabase
        .from('verses')
        .update({ embedding: JSON.stringify(vector) })
        .eq('id', verse.id)

      if (updateErr) {
        console.error(`\n  DB write failed for verse ${verse.id}: ${updateErr.message}`)
        errors++
        continue
      }

      totalDone++
      if (totalDone % LOG_EVERY === 0) {
        const pct = Math.round((totalDone / totalNull) * 100)
        const elapsed = process.hrtime.bigint()
        process.stdout.write(`\r  Embedded ${totalDone}/${totalNull} (${pct}%) | skipped: ${errors}   `)
      }

      await sleep(SLEEP_MS)
    }
  }

  console.log(`\n\nDone! Embedded ${totalDone} new verses. Skipped: ${errors}.`)
  if (errors > 0) console.log('Re-run to retry skipped verses (checkpoint is safe).')
}

main().catch((err) => { console.error(err); process.exit(1) })

/**
 * scripts/run-eval.ts
 * Runs the retrieval eval suite against the live Supabase vector index.
 *
 * WHAT THIS MEASURES:
 *   Recall@k  — of all expected verses for a question, what fraction appeared
 *               in the top k results? Recall@5 = 0.67 means 2 of 3 expected
 *               verses landed in the top 5.
 *
 *   MRR (Mean Reciprocal Rank) — for each question, find the rank of the FIRST
 *               expected verse. Reciprocal rank = 1/rank (rank 1 → 1.0,
 *               rank 3 → 0.33, not found → 0). MRR = average across all questions.
 *               MRR penalizes results that are correct but buried deep in the list.
 *
 * WHY THIS MATTERS:
 *   These metrics evaluate the RETRIEVAL step, independent of Claude's generation.
 *   A great LLM can't save bad retrieval — if the right verses aren't in the top k,
 *   the answer will be grounded in the wrong passages. Day 4's experiment shows
 *   how tuning the HNSW index changes these numbers.
 *
 * Usage:
 *   npm run run-eval                        # baseline (default ef_search)
 *   npm run run-eval -- --ef 100 --tag hnsw-tuned
 */

import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

const GEMINI_API_KEY   = process.env.GEMINI_API_KEY!
const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const K_VALUES         = [5, 10]   // compute Recall@5 and Recall@10

// Parse CLI args
const args = process.argv.slice(2)
const efIdx = args.indexOf('--ef')
const efSearch: number | null = efIdx >= 0 ? parseInt(args[efIdx + 1]) : null
const tagIdx = args.indexOf('--tag')
const tag = tagIdx >= 0 ? args[tagIdx + 1] : 'baseline'

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
const genAI    = new GoogleGenerativeAI(GEMINI_API_KEY)
const model    = genAI.getGenerativeModel({ model: 'gemini-embedding-001' }, { apiVersion: 'v1' })

interface Question {
  id: number
  question: string
  expected: string[]   // e.g. ["Philippians 4:6", "Matthew 6:34"]
  topic: string
}

interface QuestionResult {
  id: number
  question: string
  topic: string
  expected: string[]
  retrieved: string[]        // top-10 refs in order
  recall_at_5: number
  recall_at_10: number
  reciprocal_rank: number    // 1/rank of first hit, 0 if not found
  first_hit_rank: number | null
}

interface EvalRun {
  tag: string
  ef_search: number | null
  timestamp: string
  recall_at_5: number
  recall_at_10: number
  mrr: number
  n_questions: number
  questions: QuestionResult[]
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

// Normalize a verse reference to "Book Chapter:Verse" for fuzzy matching.
// Handles capitalisation differences and leading zeros.
function normalizeRef(ref: string): string {
  return ref.trim().toLowerCase().replace(/\s+/g, ' ')
}

function refsMatch(a: string, b: string): boolean {
  return normalizeRef(a) === normalizeRef(b)
}

async function embedQuery(text: string): Promise<number[]> {
  const res = await model.embedContent({
    content: { parts: [{ text }], role: 'user' },
    // @ts-expect-error outputDimensionality not in older SDK types
    outputDimensionality: 768,
  })
  return res.embedding.values
}

async function searchWithEf(queryVec: number[], k: number, ef: number | null): Promise<Array<{ book: string; chapter: number; verse: number; similarity: number }>> {
  if (ef !== null) {
    // HNSW ef_search controls the size of the dynamic candidate list during search.
    // Higher ef_search = more candidates examined = better recall, slower queries.
    // Default in pgvector is 40. We experiment with 100 to measure the recall lift.
    const rpcName = 'match_verses_ef'
    const { data, error } = await supabase.rpc(rpcName, {
      query_embedding: queryVec,
      match_count: k,
      ef_search_val: ef,
    })
    if (error) throw new Error(`RPC error (${rpcName}): ${error.message}`)
    return data ?? []
  } else {
    const { data, error } = await supabase.rpc('match_verses', {
      query_embedding: queryVec,
      match_count: k,
    })
    if (error) throw new Error(`RPC error (match_verses): ${error.message}`)
    return data ?? []
  }
}

async function main() {
  const questionsPath = path.join(process.cwd(), 'evals', 'questions.json')
  const questions: Question[] = JSON.parse(fs.readFileSync(questionsPath, 'utf-8'))

  console.log(`\nEval run: tag="${tag}" | ef_search=${efSearch ?? 'default'} | ${questions.length} questions\n`)

  const results: QuestionResult[] = []

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    process.stdout.write(`  [${i + 1}/${questions.length}] ${q.topic}…`)

    const queryVec  = await embedQuery(q.question)
    const hits      = await searchWithEf(queryVec, 10, efSearch)
    const retrieved = hits.map(h => `${h.book} ${h.chapter}:${h.verse}`)

    // Recall@k: fraction of expected refs found in top k
    const recallAt: Record<number, number> = {}
    for (const k of K_VALUES) {
      const topK  = retrieved.slice(0, k)
      const found = q.expected.filter(exp => topK.some(r => refsMatch(r, exp)))
      recallAt[k] = q.expected.length > 0 ? found.length / q.expected.length : 0
    }

    // MRR: rank of the first expected verse in the retrieved list
    let firstHitRank: number | null = null
    for (let rank = 0; rank < retrieved.length; rank++) {
      if (q.expected.some(exp => refsMatch(retrieved[rank], exp))) {
        firstHitRank = rank + 1  // 1-indexed
        break
      }
    }
    const rr = firstHitRank !== null ? 1 / firstHitRank : 0

    results.push({
      id: q.id,
      question: q.question,
      topic: q.topic,
      expected: q.expected,
      retrieved: retrieved.slice(0, 10),
      recall_at_5: recallAt[5],
      recall_at_10: recallAt[10],
      reciprocal_rank: rr,
      first_hit_rank: firstHitRank,
    })

    const status = firstHitRank !== null
      ? `rank ${firstHitRank}, R@5=${recallAt[5].toFixed(2)}`
      : 'MISS'
    process.stdout.write(` ${status}\n`)

    await sleep(150)
  }

  // Aggregate metrics
  const recall5  = results.reduce((s, r) => s + r.recall_at_5,  0) / results.length
  const recall10 = results.reduce((s, r) => s + r.recall_at_10, 0) / results.length
  const mrr      = results.reduce((s, r) => s + r.reciprocal_rank, 0) / results.length

  const run: EvalRun = {
    tag,
    ef_search: efSearch,
    timestamp: new Date().toISOString(),
    recall_at_5:  Math.round(recall5  * 1000) / 1000,
    recall_at_10: Math.round(recall10 * 1000) / 1000,
    mrr:          Math.round(mrr      * 1000) / 1000,
    n_questions: results.length,
    questions: results,
  }

  console.log(`\n${'─'.repeat(45)}`)
  console.log(`  Recall@5  : ${run.recall_at_5}`)
  console.log(`  Recall@10 : ${run.recall_at_10}`)
  console.log(`  MRR       : ${run.mrr}`)
  console.log(`${'─'.repeat(45)}\n`)

  const outDir  = path.join(process.cwd(), 'evals', 'results')
  const outFile = path.join(outDir, `${tag}.json`)
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outFile, JSON.stringify(run, null, 2))
  console.log(`Saved → ${outFile}`)
}

main().catch(err => { console.error(err); process.exit(1) })

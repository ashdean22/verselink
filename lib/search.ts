/**
 * lib/search.ts — vector similarity search over the verses table.
 *
 * HOW COSINE SIMILARITY WORKS:
 * Imagine every verse as an arrow pointing in 768-dimensional space.
 * Cosine similarity measures the angle between two arrows — 1.0 means
 * identical direction (same meaning), 0 means unrelated, -1 means opposite.
 * We embed the query the same way we embedded verses, then find the k
 * verses whose arrows point most closely in the same direction.
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import { createServiceClient } from './supabase'
import type { SearchResult } from '@/types'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
// apiVersion:'v1' required — gemini-embedding-001 is not on the default v1beta endpoint.
const embeddingModel = genAI.getGenerativeModel(
  { model: 'gemini-embedding-001' },
  { apiVersion: 'v1' }
)

export async function searchVerses(query: string, k = 10): Promise<SearchResult[]> {
  // Step 1: embed the query with the SAME model used to embed the verses.
  // Using a different model would be like measuring in inches then comparing to centimeters.
  const result = await embeddingModel.embedContent({
    content: { parts: [{ text: query }], role: 'user' },
    // @ts-expect-error outputDimensionality is valid but missing from older SDK types
    outputDimensionality: 768,
  })
  const queryVector = result.embedding.values

  // Step 2: ask Postgres to find the k nearest neighbors by cosine distance.
  // match_verses is a Postgres function (RPC) we define below — it runs the
  // vector search inside the DB where the HNSW index can accelerate it.
  const supabase = createServiceClient()
  const { data, error } = await supabase.rpc('match_verses', {
    query_embedding: queryVector,
    match_count: k,
  })

  if (error) throw new Error(`Vector search failed: ${error.message}`)

  return (data ?? []) as SearchResult[]
}

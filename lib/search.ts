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
import type { SearchResult, ChunkResult } from '@/types'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
// apiVersion:'v1' required — gemini-embedding-001 is not on the default v1beta endpoint.
const embeddingModel = genAI.getGenerativeModel(
  { model: 'gemini-embedding-001' },
  { apiVersion: 'v1' }
)

// Embed once and reuse the vector for both verse + chunk searches in a single request.
export async function embedQuery(query: string): Promise<number[]> {
  const result = await embeddingModel.embedContent({
    content: { parts: [{ text: query }], role: 'user' },
    // @ts-expect-error outputDimensionality valid but missing from older SDK types
    outputDimensionality: 768,
  })
  return result.embedding.values
}

export async function searchVerses(query: string, k = 10): Promise<SearchResult[]> {
  // Embed the query with the SAME model used to embed the verses.
  // Using a different model would be like measuring in inches then comparing to centimeters.
  const queryVector = await embedQuery(query)
  const supabase = createServiceClient()
  const { data, error } = await supabase.rpc('match_verses', {
    query_embedding: queryVector,
    match_count: k,
  })
  if (error) throw new Error(`Verse search failed: ${error.message}`)
  return (data ?? []) as SearchResult[]
}

export async function searchChunks(query: string, k = 5): Promise<ChunkResult[]> {
  const queryVector = await embedQuery(query)
  const supabase = createServiceClient()
  const { data, error } = await supabase.rpc('match_chunks', {
    query_embedding: queryVector,
    match_count: k,
  })
  if (error) throw new Error(`Chunk search failed: ${error.message}`)
  return (data ?? []) as ChunkResult[]
}

// Hybrid: embed once, search both tables in parallel, return combined results.
export async function hybridSearch(query: string, verseK = 5, chunkK = 3): Promise<{
  verses: SearchResult[]
  chunks: ChunkResult[]
}> {
  const queryVector = await embedQuery(query)
  const supabase = createServiceClient()

  const [verseRes, chunkRes] = await Promise.all([
    supabase.rpc('match_verses', { query_embedding: queryVector, match_count: verseK }),
    supabase.rpc('match_chunks', { query_embedding: queryVector, match_count: chunkK }),
  ])

  if (verseRes.error) throw new Error(`Verse search failed: ${verseRes.error.message}`)
  if (chunkRes.error) throw new Error(`Chunk search failed: ${chunkRes.error.message}`)

  return {
    verses: (verseRes.data ?? []) as SearchResult[],
    chunks: (chunkRes.data ?? []) as ChunkResult[],
  }
}

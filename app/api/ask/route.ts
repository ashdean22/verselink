/**
 * app/api/ask/route.ts — RAG pipeline Route Handler
 *
 * RAG = Retrieve, Augment, Generate. The three steps:
 *   1. RETRIEVE  — embed the question with Gemini, find the 8 most similar verses
 *   2. AUGMENT   — build a prompt that includes those 8 verses as grounded context
 *   3. GENERATE  — Claude reads only those verses and writes a citation-backed answer
 *
 * Why not just ask Claude directly without retrieval?
 * LLMs hallucinate references ("Isaiah 42:3 says…" — it doesn't). By forcing Claude
 * to work only from verses we supply, every citation is verifiable. If the retrieved
 * verses don't cover the question, Claude says so rather than inventing an answer.
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { searchVerses } from '@/lib/search'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface AskResponse {
  answer: string
  citations: Citation[]
  retrievedVerses: RetrievedVerse[]
}

export interface Citation {
  ref: string     // e.g. "Philippians 4:6"
  text: string
  relevance: string
}

export interface RetrievedVerse {
  ref: string
  text: string
  similarity: number
}

export async function POST(req: NextRequest) {
  let question: string
  try {
    const body = await req.json()
    question = body.question?.trim()
    if (!question) return NextResponse.json({ error: 'question is required' }, { status: 400 })
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  // ── Step 1: RETRIEVE ────────────────────────────────────────────────────────
  // Embed the question using the same model that embedded the verses.
  // Using a different model would break the search — vectors from different models
  // live in different spaces and can't be meaningfully compared.
  let verses
  try {
    verses = await searchVerses(question, 8)
  } catch (err) {
    console.error('Search failed:', err)
    return NextResponse.json({ error: 'search failed' }, { status: 500 })
  }

  if (verses.length === 0) {
    return NextResponse.json({ error: 'no verses found — embeddings may still be loading' }, { status: 503 })
  }

  // ── Step 2: AUGMENT ─────────────────────────────────────────────────────────
  // Format the retrieved verses as numbered context for Claude.
  const context = verses
    .map((v, i) => `[${i + 1}] ${v.book} ${v.chapter}:${v.verse} — "${v.text}"`)
    .join('\n')

  const systemPrompt = `You are a Bible study assistant. Answer questions about Scripture using ONLY the verses provided below. Do not use any Bible knowledge outside of what is given.

Rules:
1. Only cite verses from the provided list. Never invent or recall a verse not in the list.
2. If the provided verses do not adequately address the question, say so honestly.
3. Every claim you make must be tied to a specific verse from the list.
4. Be warm, pastoral, and clear — you are helping someone study Scripture.

Retrieved verses:
${context}`

  // ── Step 3: GENERATE ────────────────────────────────────────────────────────
  // We use Anthropic tool_use to force structured output.
  // Tool use is more reliable than "respond in JSON" prompting because the API
  // validates the structure before returning — Claude can never produce malformed JSON.
  let parsed: { answer: string; citations: Citation[] }
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: question }],
      tools: [
        {
          name: 'scripture_answer',
          description: 'Return a grounded Bible study answer with citations.',
          input_schema: {
            type: 'object' as const,
            properties: {
              answer: {
                type: 'string',
                description: '2-4 sentence answer grounded only in the provided verses.',
              },
              citations: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    ref:       { type: 'string', description: 'e.g. Philippians 4:6' },
                    text:      { type: 'string', description: 'Exact verse text from the provided list.' },
                    relevance: { type: 'string', description: 'One sentence on why this verse applies.' },
                  },
                  required: ['ref', 'text', 'relevance'],
                },
              },
            },
            required: ['answer', 'citations'],
          },
        },
      ],
      tool_choice: { type: 'tool' as const, name: 'scripture_answer' },
    })

    const toolBlock = message.content.find((b) => b.type === 'tool_use') as
      | { type: 'tool_use'; input: { answer: string; citations: Citation[] } }
      | undefined
    if (!toolBlock) throw new Error('no tool_use block in response')
    parsed = toolBlock.input
  } catch (err) {
    console.error('Claude failed:', err)
    return NextResponse.json({ error: 'generation failed' }, { status: 500 })
  }

  const response: AskResponse = {
    answer: parsed.answer ?? '',
    citations: parsed.citations ?? [],
    retrievedVerses: verses.map((v) => ({
      ref: `${v.book} ${v.chapter}:${v.verse}`,
      text: v.text,
      similarity: v.similarity,
    })),
  }

  return NextResponse.json(response)
}

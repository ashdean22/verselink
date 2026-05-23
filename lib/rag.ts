/**
 * lib/rag.ts — Shared RAG generation logic
 *
 * Used by /api/ask (streaming user queries) and /topics/[slug] (ISR pages).
 * Centralises the Claude tool_use call so both code paths stay in sync.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { SearchResult, ChunkResult } from '@/types'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface Citation {
  ref: string
  text: string
  relevance: string
}

export interface RAGAnswer {
  answer: string
  citations: Citation[]
}

export async function generateAnswer(
  question: string,
  verses: SearchResult[],
  chunks: ChunkResult[]
): Promise<RAGAnswer> {
  const scriptureContext = verses
    .map((v, i) => `[${i + 1}] ${v.book} ${v.chapter}:${v.verse} — "${v.text}"`)
    .join('\n')

  const commentaryContext = chunks
    .map((c, i) => {
      const label = i + verses.length + 1
      return `[${label}] Matthew Henry on ${c.book} ${c.chapter} — "${c.text}"`
    })
    .join('\n\n')

  const systemPrompt = `You are a Bible study assistant. Answer questions using ONLY the Scripture verses and commentary excerpts provided below. Do not use any knowledge outside what is given.

Rules:
1. Only cite verses and commentary from the provided lists. Never invent references.
2. If the provided material does not adequately address the question, say so honestly.
3. Every claim must be tied to a specific item from the lists.
4. Be warm, pastoral, and clear.
5. When commentary is available, use it to explain context or application — but Scripture takes priority.

SCRIPTURE VERSES:
${scriptureContext}
${chunks.length > 0 ? `\nMATTHEW HENRY COMMENTARY EXCERPTS:\n${commentaryContext}` : ''}`

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
              description: '2-4 sentence answer grounded only in the provided verses and commentary.',
            },
            citations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  ref:       { type: 'string' },
                  text:      { type: 'string' },
                  relevance: { type: 'string' },
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

  const toolBlock = message.content.find(b => b.type === 'tool_use') as
    | { type: 'tool_use'; input: RAGAnswer }
    | undefined

  if (!toolBlock) throw new Error('No tool_use block in Claude response')
  return toolBlock.input
}

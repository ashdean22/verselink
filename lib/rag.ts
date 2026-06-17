/**
 * lib/rag.ts — Shared RAG generation logic
 *
 * Used by /api/ask (streaming user queries) and /topics/[slug] (ISR pages).
 * Centralises the Claude tool_use call AND the system-prompt builder so every
 * code path (Claude, OpenRouter, self-host) sees the same grounding rules.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { SearchResult, ChunkResult } from '@/types'
import { traditionLabel, chunkRef } from '@/lib/commentary'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface Citation {
  ref: string
  text: string
  relevance: string
  tradition?: string   // set for commentary citations: 'Reformed', 'Catholic', …
}

export interface RAGAnswer {
  answer: string
  citations: Citation[]
}

// CORE DOCTRINES — never relativized. The corpus now spans several traditions
// (Reformed, Arminian, Evangelical, Puritan, Catholic) that genuinely disagree
// on *secondary* matters. These first-order doctrines are common ground across
// historic Christianity and must be presented as settled, not as "one view."
const CORE_DOCTRINES = `CORE DOCTRINES (never relativize or present as one option among many):
- The Trinity: one God in three persons — Father, Son, and Holy Spirit.
- The full deity and bodily resurrection of Jesus Christ.
- Salvation by grace through faith in Christ.
- The authority and trustworthiness of Scripture.`

// Build the grounding system prompt shared by all generation backends.
export function buildSystemPrompt(verses: SearchResult[], chunks: ChunkResult[]): string {
  const scriptureContext = verses
    .map((v, i) => `[${i + 1}] ${v.book} ${v.chapter}:${v.verse} — "${v.text}"`)
    .join('\n')

  // Each commentary excerpt is labelled with its author AND tradition so the
  // model can attribute differing views to the right camp.
  const commentaryContext = chunks
    .map((c, i) => {
      const label = i + verses.length + 1
      return `[${label}] ${c.doc_title} (${traditionLabel(c.tradition)}) on ${c.book} ${c.chapter} — "${c.text}"`
    })
    .join('\n\n')

  return `You are a Bible study assistant. Answer questions using ONLY the Scripture verses and commentary excerpts provided below. Do not use any Bible knowledge or theological knowledge outside what is given.

${CORE_DOCTRINES}

Rules:
1. Only cite verses and commentary from the provided lists. Never invent references.
2. If the provided material does not adequately address the question, say so honestly.
3. Every claim must be tied to a specific item from the lists.
4. Be warm, pastoral, and clear — you are helping someone study Scripture.
5. When commentary is available, use it to explain context or application — but Scripture takes priority.
6. The commentaries come from different traditions (shown in parentheses). On SECONDARY matters where they differ, present the differing views side by side and name the tradition for each (e.g. "Calvin, from the Reformed tradition, holds… while Clarke, an Arminian, emphasizes…"). Do not flatten them into a single take, and do not pick a winner.
7. For any commentary citation, set its "tradition" field to that source's tradition.

SCRIPTURE VERSES:
${scriptureContext}
${chunks.length > 0 ? `\nCOMMENTARY EXCERPTS (with tradition):\n${commentaryContext}` : ''}`
}

// Shared tool schema (Anthropic format). The OpenAI-format mirror lives in the
// ask route; keep the two in sync when changing fields.
export const SCRIPTURE_ANSWER_TOOL = {
  name: 'scripture_answer',
  description: 'Return a grounded Bible study answer with citations from Scripture and/or commentary.',
  input_schema: {
    type: 'object' as const,
    properties: {
      answer: {
        type: 'string',
        description: '2-4 sentence answer grounded only in the provided verses and commentary. Present differing secondary views side by side, naming each tradition.',
      },
      citations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            ref:       { type: 'string', description: 'e.g. "Philippians 4:6" for Scripture, or "John Calvin on Romans 8" for commentary.' },
            text:      { type: 'string', description: 'Exact text from the provided list.' },
            relevance: { type: 'string', description: 'One sentence on why this source applies.' },
            tradition: { type: 'string', description: 'For commentary citations only: the tradition label (Reformed, Arminian, Evangelical, Puritan, Catholic).' },
          },
          required: ['ref', 'text', 'relevance'],
        },
      },
    },
    required: ['answer', 'citations'],
  },
}

export async function generateAnswer(
  question: string,
  verses: SearchResult[],
  chunks: ChunkResult[]
): Promise<RAGAnswer> {
  const systemPrompt = buildSystemPrompt(verses, chunks)

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: question }],
    tools: [SCRIPTURE_ANSWER_TOOL],
    tool_choice: { type: 'tool' as const, name: 'scripture_answer' },
  })

  const toolBlock = message.content.find(b => b.type === 'tool_use') as
    | { type: 'tool_use'; input: RAGAnswer }
    | undefined

  if (!toolBlock) throw new Error('No tool_use block in Claude response')
  return toolBlock.input
}

// Re-export so callers building commentary refs/labels have one import site.
export { traditionLabel, chunkRef }

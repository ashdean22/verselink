/**
 * app/api/ask/route.ts — Hybrid RAG pipeline Route Handler
 *
 * Generation dispatch (set via GENERATION_MODEL env var, or per-request `model`):
 *   selfhost:*   → self-hosted fine-tune (plain text) + Claude fallback
 *   claude-*     → Anthropic SDK (tool-use structured output)
 *   deepinfra:*  → DeepInfra serverless
 *   groq:*       → Groq
 *   else         → OpenRouter
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { hybridSearch } from '@/lib/search'
import { buildSystemPrompt, SCRIPTURE_ANSWER_TOOL } from '@/lib/rag'
import { traditionLabel, chunkRef } from '@/lib/commentary'

export const runtime = 'nodejs'
export const maxDuration = 60   // self-host generation can take >10s; needs Vercel Pro/Fluid

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface AskResponse {
  answer: string
  citations: Citation[]
  retrievedVerses: RetrievedVerse[]
  retrievedChunks: RetrievedChunk[]
  inputTokens?: number
  outputTokens?: number
}

export interface Citation {
  ref: string
  text: string
  relevance: string
  tradition?: string
}

export interface RetrievedVerse {
  ref: string
  text: string
  similarity: number
}

export interface RetrievedChunk {
  ref: string
  text: string
  similarity: number
  source: string       // doc_title, e.g. "John Calvin"
  tradition: string    // display label, e.g. "Reformed"
}

export async function POST(req: NextRequest) {
  let question: string
  let includeUsage = false
  // Default model is controlled by the GENERATION_MODEL env var (the feature
  // flag). A per-request `model` still overrides it (used by the benchmark).
  let generationModel = process.env.GENERATION_MODEL || 'claude-sonnet-4-6'
  try {
    const body = await req.json()
    question = body.question?.trim()
    includeUsage = body.includeUsage === true
    if (body.model) generationModel = body.model
    if (!question) return NextResponse.json({ error: 'question is required' }, { status: 400 })
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  // ── Step 1: RETRIEVE (hybrid — one embed, two searches in parallel) ──────────
  let verses: Awaited<ReturnType<typeof hybridSearch>>['verses']
  let chunks: Awaited<ReturnType<typeof hybridSearch>>['chunks']
  try {
    const result = await hybridSearch(question, 5, 6, 2)
    verses = result.verses
    chunks = result.chunks
  } catch (err) {
    console.error('Hybrid search failed:', err)
    return NextResponse.json({ error: 'search failed' }, { status: 500 })
  }

  if (verses.length === 0 && chunks.length === 0) {
    return NextResponse.json({ error: 'no content found — embeddings may still be loading' }, { status: 503 })
  }

  // ── Step 2: AUGMENT ──────────────────────────────────────────────────────────
  // Shared builder (lib/rag.ts): core-doctrines guardrail + tradition-labelled
  // commentary + side-by-side instruction. Same prompt for every backend below.
  const systemPrompt = buildSystemPrompt(verses, chunks)

  // ── Step 3: GENERATE ─────────────────────────────────────────────────────────
  let parsed: { answer: string; citations: Citation[] }
  let inputTokens = 0
  let outputTokens = 0

  // Shared tool schema in OpenAI format — for the hosted OpenAI-compatible providers.
  const openAITools = [{
    type: 'function' as const,
    function: {
      name: 'scripture_answer',
      description: 'Return a grounded Bible study answer with citations from Scripture and/or commentary.',
      parameters: {
        type: 'object',
        properties: {
          answer:    { type: 'string', description: '2-4 sentence answer grounded only in the provided verses and commentary.' },
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
    },
  }]

  // Build citation cards for the self-host path, which returns prose (no tool JSON).
  // We surface the retrieved passages the answer actually references; if none match
  // by string, we fall back to the top retrieved verses so cards are never empty.
  function buildCitations(answer: string): Citation[] {
    const cites: Citation[] = []
    for (const v of verses) {
      const ref = `${v.book} ${v.chapter}:${v.verse}`
      if (answer.includes(ref) || answer.includes(`${v.book} ${v.chapter}`)) {
        cites.push({ ref, text: v.text, relevance: 'Referenced in the answer.' })
      }
    }
    for (const c of chunks) {
      if (answer.includes(`${c.book} ${c.chapter}`) || answer.includes(c.doc_title)) {
        cites.push({
          ref: chunkRef(c),
          text: c.text,
          relevance: 'Commentary context.',
          tradition: traditionLabel(c.tradition),
        })
      }
    }
    if (cites.length === 0) {
      for (const v of verses.slice(0, 3)) {
        cites.push({ ref: `${v.book} ${v.chapter}:${v.verse}`, text: v.text, relevance: 'Retrieved as relevant to your question.' })
      }
    }
    return cites
  }

  async function callOpenAICompatible(
    endpoint: string,
    apiKey: string,
    modelId: string,
    extraHeaders: Record<string, string> = {}
  ) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, ...extraHeaders },
      body: JSON.stringify({
        model:      modelId,
        max_tokens: 1024,
        messages:   [{ role: 'system', content: systemPrompt }, { role: 'user', content: question }],
        tools:      openAITools,
        tool_choice: { type: 'function', function: { name: 'scripture_answer' } },
      }),
    })
    if (!res.ok) throw new Error(`${endpoint} ${res.status}: ${await res.text()}`)
    const data = await res.json()
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0]
    if (!toolCall) throw new Error(`no tool_call in response from ${endpoint}`)
    return {
      parsed:       JSON.parse(toolCall.function.arguments) as { answer: string; citations: Citation[] },
      inputTokens:  data.usage?.prompt_tokens     ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    }
  }

  // Self-hosted fine-tune: plain text completion. Gemma 2 has no system role,
  // so the prompt is folded into a single user turn (matches the eval format).
  async function callSelfHostPlain(endpoint: string, apiKey: string, modelId: string) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 55000)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model:      modelId,
          max_tokens: 1024,
          messages:   [{ role: 'user', content: `${systemPrompt}\n\nQuestion: ${question}` }],
        }),
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`selfhost ${res.status}: ${await res.text()}`)
      const data = await res.json()
      const content: string = data.choices?.[0]?.message?.content
      if (!content) throw new Error('no content in self-host response')
      return {
        parsed:       { answer: content.trim(), citations: buildCitations(content) },
        inputTokens:  0,
        outputTokens: 0,
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async function generateWithClaude(modelId: string) {
    const message = await anthropic.messages.create({
      model: modelId,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: question }],
      tools: [SCRIPTURE_ANSWER_TOOL],
      tool_choice: { type: 'tool' as const, name: 'scripture_answer' },
    })
    const toolBlock = message.content.find(b => b.type === 'tool_use') as
      | { type: 'tool_use'; input: { answer: string; citations: Citation[] } }
      | undefined
    if (!toolBlock) throw new Error('no tool_use block in Claude response')
    return {
      parsed:       toolBlock.input,
      inputTokens:  message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    }
  }

  try {
    if (generationModel.startsWith('selfhost:')) {
      const modelId = generationModel.slice('selfhost:'.length)
      try {
        ;({ parsed, inputTokens, outputTokens } = await callSelfHostPlain(
          process.env.SELFHOST_URL!,
          process.env.SELFHOST_API_KEY!,
          modelId,
        ))
      } catch (err) {
        console.error('Self-host failed — falling back to Claude:', err)
        ;({ parsed, inputTokens, outputTokens } = await generateWithClaude('claude-sonnet-4-6'))
      }

    } else if (generationModel.startsWith('claude-')) {
      ;({ parsed, inputTokens, outputTokens } = await generateWithClaude(generationModel))

    } else if (generationModel.startsWith('deepinfra:')) {
      const modelId = generationModel.slice('deepinfra:'.length)
      ;({ parsed, inputTokens, outputTokens } = await callOpenAICompatible(
        'https://api.deepinfra.com/v1/openai/chat/completions',
        process.env.DEEPINFRA_API_KEY!,
        modelId,
      ))

    } else if (generationModel.startsWith('groq:')) {
      const modelId = generationModel.slice('groq:'.length)
      ;({ parsed, inputTokens, outputTokens } = await callOpenAICompatible(
        'https://api.groq.com/openai/v1/chat/completions',
        process.env.GROQ_API_KEY!,
        modelId,
      ))

    } else {
      ;({ parsed, inputTokens, outputTokens } = await callOpenAICompatible(
        'https://openrouter.ai/api/v1/chat/completions',
        process.env.OPENROUTER_API_KEY!,
        generationModel,
        { 'HTTP-Referer': 'https://verselink.app', 'X-Title': 'VerseLink' },
      ))
    }
  } catch (err) {
    console.error('Generation failed:', err)
    return NextResponse.json({ error: 'generation failed' }, { status: 500 })
  }

  const response: AskResponse = {
    answer:    parsed.answer ?? '',
    citations: parsed.citations ?? [],
    retrievedVerses: verses.map(v => ({
      ref:        `${v.book} ${v.chapter}:${v.verse}`,
      text:       v.text,
      similarity: v.similarity,
    })),
    retrievedChunks: chunks.map(c => ({
      ref:        chunkRef(c),
      text:       c.text,
      similarity: c.similarity,
      source:     c.doc_title,
      tradition:  traditionLabel(c.tradition),
    })),
  }

  if (includeUsage) {
    response.inputTokens = inputTokens
    response.outputTokens = outputTokens
  }

  return NextResponse.json(response)
}
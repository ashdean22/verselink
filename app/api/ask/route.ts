/**
 * app/api/ask/route.ts — Hybrid RAG pipeline Route Handler
 *
 * Day 5 upgrade: retrieval now spans TWO corpora in parallel:
 *   • verses table  — 31,098 WEB Bible verses
 *   • chunks table  — Matthew Henry's Commentary (1708), ~500-token chunks
 *
 * RAG steps:
 *   1. RETRIEVE  — embed the question once, search both tables simultaneously
 *   2. AUGMENT   — build a prompt with labeled Scripture + Commentary sections
 *   3. GENERATE  — Claude answers using only what was retrieved; no hallucination
 *
 * WHY HYBRID RETRIEVAL:
 *   A verse alone ("Be anxious for nothing") tells you WHAT Scripture says.
 *   Commentary ("Henry explains that Paul's command implies prayer as the cure
 *   for worry") tells you WHY and HOW. The combination gives Claude richer
 *   grounding to write pastoral, useful answers.
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { hybridSearch } from '@/lib/search'

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
}

export interface RetrievedVerse {
  ref: string
  text: string
  similarity: number
}

export interface RetrievedChunk {
  ref: string       // e.g. "Matthew Henry on Romans 8"
  text: string
  similarity: number
}

export async function POST(req: NextRequest) {
  let question: string
  let includeUsage = false
  // generationModel: defaults to Claude; pass an OpenRouter model ID (e.g.
  // "meta-llama/llama-3.3-70b-instruct") to swap only the generate step —
  // retrieval, prompt, and schema stay identical (apples-to-apples bake-off).
  let generationModel = 'claude-sonnet-4-6'
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
    const result = await hybridSearch(question, 5, 3)
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
  // Label context clearly so Claude knows which source type each item came from.
  const scriptureContext = verses
    .map((v, i) => `[${i + 1}] ${v.book} ${v.chapter}:${v.verse} — "${v.text}"`)
    .join('\n')

  const commentaryContext = chunks
    .map((c, i) => {
      const label = i + verses.length + 1
      return `[${label}] Matthew Henry on ${c.book} ${c.chapter} — "${c.text}"`
    })
    .join('\n\n')

  const hasCommentary = chunks.length > 0

  const systemPrompt = `You are a Bible study assistant. Answer questions using ONLY the Scripture verses and commentary excerpts provided below. Do not use any Bible knowledge or theological knowledge outside what is given.

Rules:
1. Only cite verses and commentary from the provided lists. Never invent references.
2. If the provided material does not adequately address the question, say so honestly.
3. Every claim must be tied to a specific item from the lists.
4. Be warm, pastoral, and clear — you are helping someone study Scripture.
5. When commentary is available, use it to explain context or application — but Scripture takes priority.

SCRIPTURE VERSES:
${scriptureContext}
${hasCommentary ? `\nMATTHEW HENRY COMMENTARY EXCERPTS:\n${commentaryContext}` : ''}`

  // ── Step 3: GENERATE ─────────────────────────────────────────────────────────
  // Provider dispatch based on model prefix:
  //   claude-*      → Anthropic SDK
  //   deepinfra:*   → DeepInfra serverless (strip prefix, use DEEPINFRA_API_KEY)
  //   groq:*        → Groq (strip prefix, use GROQ_API_KEY)
  //   anything else → OpenRouter (pass model ID as-is, use OPENROUTER_API_KEY)
  // All non-Claude paths share the same OpenAI-compatible fetch helper below.
  let parsed: { answer: string; citations: Citation[] }
  let inputTokens = 0
  let outputTokens = 0

  // Shared tool schema in OpenAI format — identical for every non-Claude provider.
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
                ref:       { type: 'string', description: 'e.g. "Philippians 4:6" or "Matthew Henry on Philippians 4"' },
                text:      { type: 'string', description: 'Exact text from the provided list.' },
                relevance: { type: 'string', description: 'One sentence on why this source applies.' },
              },
              required: ['ref', 'text', 'relevance'],
            },
          },
        },
        required: ['answer', 'citations'],
      },
    },
  }]

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

  try {
    if (generationModel.startsWith('claude-')) {
      const message = await anthropic.messages.create({
        model: generationModel,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: question }],
        tools: [{
          name: 'scripture_answer',
          description: 'Return a grounded Bible study answer with citations from Scripture and/or commentary.',
          input_schema: {
            type: 'object' as const,
            properties: {
              answer:    { type: 'string', description: '2-4 sentence answer grounded only in the provided verses and commentary.' },
              citations: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    ref:       { type: 'string', description: 'e.g. "Philippians 4:6" or "Matthew Henry on Philippians 4"' },
                    text:      { type: 'string', description: 'Exact text from the provided list.' },
                    relevance: { type: 'string', description: 'One sentence on why this source applies.' },
                  },
                  required: ['ref', 'text', 'relevance'],
                },
              },
            },
            required: ['answer', 'citations'],
          },
        }],
        tool_choice: { type: 'tool' as const, name: 'scripture_answer' },
      })
      const toolBlock = message.content.find(b => b.type === 'tool_use') as
        | { type: 'tool_use'; input: { answer: string; citations: Citation[] } }
        | undefined
      if (!toolBlock) throw new Error('no tool_use block in Claude response')
      parsed       = toolBlock.input
      inputTokens  = message.usage.input_tokens
      outputTokens = message.usage.output_tokens

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
      // Default: OpenRouter — pass model ID as-is (e.g. "meta-llama/llama-3.3-70b-instruct")
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
      ref:        `Matthew Henry on ${c.book} ${c.chapter}`,
      text:       c.text,
      similarity: c.similarity,
    })),
  }

  // Benchmark-only telemetry — included only when caller passes `includeUsage: true`
  if (includeUsage) {
    response.inputTokens = inputTokens
    response.outputTokens = outputTokens
  }

  return NextResponse.json(response)
}

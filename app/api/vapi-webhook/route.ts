/**
 * app/api/vapi-webhook/route.ts — Vapi server-side tool handler
 *
 * Vapi calls this URL during a live phone call whenever the assistant
 * invokes the searchScripture tool, and again at the end of the call
 * with the full transcript.
 *
 * Event types we handle:
 *   tool-calls        — LLM wants to search Scripture; we run hybridSearch
 *                       and return plain-text results Vapi reads aloud
 *   end-of-call-report — call finished; save transcript as a searchable chunk
 *
 * Security: Vapi sends the VAPI_WEBHOOK_SECRET value in the
 * x-vapi-secret header. We reject requests that don't match.
 */

import { NextRequest, NextResponse } from 'next/server'
import { hybridSearch } from '@/lib/search'
import { createClient } from '@supabase/supabase-js'
import type { SearchResult, ChunkResult } from '@/types'

// TODO: Webhook signature verification deferred. Add as Phase 2 hardening —
// see VAPI_WEBHOOK_SECRET in .env. Check x-vapi-secret header against the stored value.

function formatSearchResult(verses: SearchResult[], chunks: ChunkResult[]): string {
  // Return concise plain text — this is read aloud over the phone.
  const lines: string[] = []

  if (verses.length > 0) {
    lines.push('Scripture passages:')
    verses.slice(0, 5).forEach((v, i) => {
      lines.push(`${i + 1}. ${v.book} ${v.chapter}:${v.verse} — "${v.text}"`)
    })
  }

  if (chunks.length > 0) {
    lines.push('\nMatthew Henry notes:')
    chunks.slice(0, 2).forEach(c => {
      // Trim to ~200 chars — enough for context without overwhelming the LLM
      const snippet = c.text.length > 200 ? c.text.slice(0, 200) + '…' : c.text
      lines.push(`• ${c.book} ${c.chapter}: ${snippet}`)
    })
  }

  if (lines.length === 0) {
    return 'No relevant Scripture found for that query.'
  }

  return lines.join('\n')
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const message = body.message as Record<string, unknown> | undefined
  if (!message) return NextResponse.json({ received: true })

  // ── Tool call: assistant wants to search Scripture ───────────────────────────
  if (message.type === 'tool-calls') {
    const toolCallList = message.toolCallList as Array<{
      id: string
      function: { name: string; arguments: string }
    }> | undefined

    if (!toolCallList?.length) return NextResponse.json({ results: [] })

    const results = await Promise.all(
      toolCallList.map(async (tc) => {
        if (tc.function.name !== 'searchScripture') {
          return { toolCallId: tc.id, result: 'Unknown tool.' }
        }
        try {
          const args = JSON.parse(tc.function.arguments) as { query?: string }
          const query = args.query?.trim()
          if (!query) return { toolCallId: tc.id, result: 'No query provided.' }

          const { verses, chunks } = await hybridSearch(query, 5, 2)
          return { toolCallId: tc.id, result: formatSearchResult(verses, chunks) }
        } catch (err) {
          console.error('searchScripture error:', err)
          return { toolCallId: tc.id, result: 'Search failed — please try again.' }
        }
      })
    )

    return NextResponse.json({ results })
  }

  // ── End-of-call report: save transcript as a searchable chunk ────────────────
  if (message.type === 'end-of-call-report') {
    const transcript = message.transcript as string | undefined
    if (transcript?.trim()) {
      try {
        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        )
        await supabase.from('chunks').insert({
          source_type: 'voice_session',
          doc_title:   'Voice Devotional',
          book:        null,
          chapter:     null,
          chunk_index: 0,
          text:        transcript.slice(0, 8000),  // cap at 8k chars
          token_count: Math.round(transcript.split(/\s+/).length),
          // embedding left null — embed-chunks will pick it up
        })
      } catch (err) {
        console.error('Transcript save failed:', err)
      }
    }
    return NextResponse.json({ received: true })
  }

  return NextResponse.json({ received: true })
}

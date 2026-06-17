/**
 * lib/commentary.ts — shared helpers for the multi-tradition commentary corpus.
 * Pure functions only (no server deps) so both Route Handlers and client
 * components can import them.
 */

import type { ChunkResult } from '@/types'

// Display labels for the tradition tag shown on commentary citations.
export const TRADITION_LABELS: Record<string, string> = {
  reformed:    'Reformed',
  arminian:    'Arminian',
  evangelical: 'Evangelical',
  puritan:     'Puritan',
  catholic:    'Catholic',
}

export function traditionLabel(tradition: string | undefined | null): string {
  if (!tradition) return ''
  return TRADITION_LABELS[tradition] ?? tradition
}

// Canonical citation/reference string for a commentary chunk, e.g.
//   "John Calvin on Romans 8". Voice/personal chunks have no book → just the title.
export function chunkRef(c: Pick<ChunkResult, 'doc_title' | 'book' | 'chapter'>): string {
  if (!c.book) return c.doc_title
  return `${c.doc_title} on ${c.book} ${c.chapter}`
}

// A scripture citation ends in "chapter:verse"; a commentary one does not.
// Used by the UI to decide whether to render a verse link or a commentary card.
export function isVerseCitation(ref: string): boolean {
  return /\d+:\d+\s*$/.test(ref)
}

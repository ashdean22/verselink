export interface Verse {
  id: number
  book: string
  chapter: number
  verse: number
  text: string
  embedding: number[] | null
}

export interface SearchResult {
  id: number
  book: string
  chapter: number
  verse: number
  text: string
  similarity: number
}

export interface ChunkResult {
  id: number
  source_type: string
  doc_title: string
  tradition: string
  book: string
  chapter: number
  chunk_index: number
  text: string
  similarity: number
}

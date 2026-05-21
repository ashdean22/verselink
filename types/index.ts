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

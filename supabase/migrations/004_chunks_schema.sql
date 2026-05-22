-- 004_chunks_schema.sql
--
-- Secondary corpus table for commentary chunks (Day 5).
-- The same HNSW + cosine-similarity pattern as the verses table,
-- but the rows are text chunks from Matthew Henry's Commentary.
--
-- CHUNKING WITH OVERLAP (key concept):
--   Long documents are split into overlapping windows so that a sentence
--   near the boundary of one chunk also appears at the start of the next.
--   Without overlap, a query whose answer straddles two chunks would miss it.
--   We use ~500-token chunks (≈375 words) with ~50-token overlap (≈37 words).

CREATE TABLE IF NOT EXISTS chunks (
  id           bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  source_type  text    NOT NULL DEFAULT 'commentary',
  doc_title    text    NOT NULL DEFAULT 'Matthew Henry',
  book         text,
  chapter      integer,
  chunk_index  integer NOT NULL,
  text         text    NOT NULL,
  token_count  integer,
  embedding    vector(768)
);

-- Same HNSW index pattern as verses: approximate nearest-neighbour,
-- cosine distance, m=16 (graph connectivity), ef_construction=64 (build quality).
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_idx
  ON chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Unique constraint so the load script can use upsert safely.
CREATE UNIQUE INDEX IF NOT EXISTS chunks_book_chapter_idx_uniq
  ON chunks (doc_title, book, chapter, chunk_index);

-- match_chunks: same shape as match_verses — returns top-k chunks by cosine similarity.
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding vector(768),
  match_count     int DEFAULT 5
)
RETURNS TABLE (
  id          bigint,
  source_type text,
  doc_title   text,
  book        text,
  chapter     integer,
  chunk_index integer,
  text        text,
  similarity  float
)
LANGUAGE sql STABLE AS $$
  SELECT
    id, source_type, doc_title, book, chapter, chunk_index, text,
    1 - (embedding <=> query_embedding) AS similarity
  FROM chunks
  WHERE embedding IS NOT NULL
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

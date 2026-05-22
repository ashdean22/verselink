-- ============================================================
-- Migration 002: match_verses RPC function + HNSW index
-- Run this in Supabase SQL Editor AFTER embed-bible.ts finishes.
-- ============================================================

-- HNSW INDEX (Hierarchical Navigable Small World):
-- Without an index, every search scans all 31k rows and computes cosine
-- distance one by one. HNSW builds a navigation graph at index time so
-- searches can jump to approximate nearest neighbors in milliseconds.
-- vector_cosine_ops = use cosine distance as the similarity measure.
CREATE INDEX IF NOT EXISTS verses_embedding_hnsw_idx
  ON verses USING hnsw (embedding vector_cosine_ops);

-- match_verses: called via supabase.rpc('match_verses', {...})
-- Takes a query embedding (768 floats) and returns the k most similar verses.
-- 1 - (embedding <=> query_embedding) converts cosine DISTANCE to SIMILARITY
-- so higher numbers = more relevant (1.0 = identical, 0 = unrelated).
CREATE OR REPLACE FUNCTION match_verses(
  query_embedding vector(768),
  match_count     int DEFAULT 10
)
RETURNS TABLE (
  id         bigint,
  book       text,
  chapter    integer,
  verse      integer,
  text       text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    id,
    book,
    chapter,
    verse,
    text,
    1 - (embedding <=> query_embedding) AS similarity
  FROM verses
  WHERE embedding IS NOT NULL
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

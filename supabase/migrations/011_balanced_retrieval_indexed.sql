-- 011_balanced_retrieval_indexed.sql
--
-- WHAT: Rewrites match_chunks_balanced so it actually uses the HNSW index.
--
-- WHY: The previous version (migration 010) ranked chunks with
--        ROW_NUMBER() OVER (PARTITION BY tradition ORDER BY embedding <=> q)
--      over the WHOLE table. A windowed ORDER BY can't use the HNSW index, so
--      every query did an EXACT full scan of all ~80k vectors → 7-8s per query
--      (and statement timeouts under load).
--
-- FIX — "retrieve then diversify" (the standard fast pattern):
--   1. Use the HNSW index to grab a CANDIDATE POOL of the N nearest commentary
--      chunks overall (a plain `ORDER BY embedding <=> q LIMIT N` — index-accelerated,
--      a few ms).
--   2. Within that small pool, rank per tradition with a window function and keep
--      at most `per_tradition` from each, so results still spread across traditions
--      instead of being dominated by the most verbose author.
--   The window function now runs over ~200 rows, not 80k.
--
-- Voice-session chunks (tradition IS NULL) are excluded from this commentary
-- retrieval path.

-- Drop the old 3-arg version from migration 010. Adding the candidate_pool param
-- makes a NEW overload, so without this the app's 3-arg call would still resolve
-- to the old slow full-scan function.
DROP FUNCTION IF EXISTS match_chunks_balanced(vector(768), int, int);

CREATE OR REPLACE FUNCTION match_chunks_balanced(
  query_embedding vector(768),
  match_count     int DEFAULT 6,
  per_tradition   int DEFAULT 2,
  candidate_pool  int DEFAULT 200
)
RETURNS TABLE (
  id          bigint,
  source_type text,
  doc_title   text,
  tradition   text,
  book        text,
  chapter     integer,
  chunk_index integer,
  text        text,
  similarity  float
)
LANGUAGE sql STABLE AS $$
  WITH pool AS (
    -- HNSW-accelerated approximate nearest neighbours (index handles this).
    SELECT
      c.id, c.source_type, c.doc_title, c.tradition, c.book, c.chapter,
      c.chunk_index, c.text,
      1 - (c.embedding <=> query_embedding) AS similarity
    FROM chunks c
    WHERE c.embedding IS NOT NULL
      AND c.tradition IS NOT NULL
    ORDER BY c.embedding <=> query_embedding
    LIMIT candidate_pool
  ),
  ranked AS (
    SELECT
      pool.*,
      ROW_NUMBER() OVER (
        PARTITION BY pool.tradition
        ORDER BY pool.similarity DESC
      ) AS rank_in_tradition
    FROM pool
  )
  SELECT
    id, source_type, doc_title, tradition, book, chapter, chunk_index, text, similarity
  FROM ranked
  WHERE rank_in_tradition <= per_tradition
  ORDER BY similarity DESC
  LIMIT match_count;
$$;

-- 010_commentary_traditions.sql
--
-- WHAT: Expands the single-commentary corpus (Matthew Henry only) into a
--       multi-commentary, multi-tradition corpus. Adds a `tradition` column,
--       backfills the existing Henry rows, and adds a *balanced* retrieval
--       function so search results spread across traditions instead of being
--       dominated by whichever author happens to be the most verbose.
--
-- NOTE: `doc_title` already exists on `chunks` (added in 004) — it defaulted to
--       'Matthew Henry'. We only need to add `tradition` here.

-- ── 1. tradition column ──────────────────────────────────────────────────────
-- Plain text + CHECK constraint (rather than a Postgres ENUM type) so adding a
-- new tradition later is a one-line constraint change, not an ALTER TYPE dance.
ALTER TABLE chunks
  ADD COLUMN IF NOT EXISTS tradition text;

-- Backfill: every existing chunk is Matthew Henry → puritan.
UPDATE chunks
  SET tradition = 'puritan'
  WHERE doc_title = 'Matthew Henry' AND tradition IS NULL;

-- Constrain to the known traditions. Drop-then-add so re-running the migration
-- (or widening the list) is safe.
ALTER TABLE chunks DROP CONSTRAINT IF EXISTS chunks_tradition_check;
ALTER TABLE chunks ADD CONSTRAINT chunks_tradition_check
  CHECK (tradition IN ('reformed', 'arminian', 'evangelical', 'puritan', 'catholic'));

-- An index on tradition speeds up the PARTITION BY in the balanced function below.
CREATE INDEX IF NOT EXISTS chunks_tradition_idx ON chunks (tradition);

-- ── 2. balanced retrieval function ───────────────────────────────────────────
-- BALANCED (DIVERSITY-AWARE) RETRIEVAL — key concept:
--   Plain top-k nearest-neighbour search returns the k closest chunks regardless
--   of source. If John Gill writes 3x more than everyone else, the top 6 results
--   can all be Gill — you lose the cross-tradition perspective that's the whole
--   point of having multiple commentaries.
--
--   The fix is a lightweight version of "Maximal Marginal Relevance": instead of
--   ranking all chunks together, we rank them *within each tradition* using a
--   window function (ROW_NUMBER ... PARTITION BY tradition), keep only the top
--   `per_tradition` from each, then sort that diversified pool by similarity and
--   return the best `match_count`. The result is guaranteed to draw from several
--   traditions while still preferring the most semantically relevant chunks.
CREATE OR REPLACE FUNCTION match_chunks_balanced(
  query_embedding vector(768),
  match_count     int DEFAULT 6,
  per_tradition   int DEFAULT 2
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
  WITH ranked AS (
    SELECT
      c.id, c.source_type, c.doc_title, c.tradition, c.book, c.chapter,
      c.chunk_index, c.text,
      1 - (c.embedding <=> query_embedding) AS similarity,
      -- Rank chunks 1..N within each tradition by closeness to the query.
      ROW_NUMBER() OVER (
        PARTITION BY c.tradition
        ORDER BY c.embedding <=> query_embedding
      ) AS rank_in_tradition
    FROM chunks c
    WHERE c.embedding IS NOT NULL
  )
  SELECT
    id, source_type, doc_title, tradition, book, chapter, chunk_index, text, similarity
  FROM ranked
  WHERE rank_in_tradition <= per_tradition
  ORDER BY similarity DESC
  LIMIT match_count;
$$;

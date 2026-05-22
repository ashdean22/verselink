-- 003_match_verses_ef.sql
--
-- WHAT: Adds match_verses_ef — a variant of match_verses that lets the caller
--       override the HNSW ef_search parameter at query time without touching the index.
--
-- WHY ef_search matters (Recall@k experiment, Day 4):
--   HNSW builds a graph of vectors. At search time, it walks the graph keeping a
--   "dynamic candidate list" of size ef_search. Larger list → more nodes examined
--   → better recall (fewer expected verses missed) but slower queries.
--   pgvector's default is 40. We test 100 to measure the recall lift.
--
-- HOW: SET LOCAL hnsw.ef_search = N applies only inside this transaction/function call,
--       so it doesn't affect any other concurrent queries.

CREATE OR REPLACE FUNCTION match_verses_ef(
  query_embedding vector(768),
  match_count     int     DEFAULT 10,
  ef_search_val   int     DEFAULT 40
)
RETURNS TABLE (
  id         bigint,
  book       text,
  chapter    integer,
  verse      integer,
  text       text,
  similarity float
)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  -- Override HNSW candidate list size for this call only.
  -- Higher value = better recall, more CPU per query.
  PERFORM set_config('hnsw.ef_search', ef_search_val::text, true);

  RETURN QUERY
    SELECT
      v.id,
      v.book,
      v.chapter,
      v.verse,
      v.text,
      1 - (v.embedding <=> query_embedding) AS similarity
    FROM verses v
    WHERE v.embedding IS NOT NULL
    ORDER BY v.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

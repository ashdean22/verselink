-- ============================================================
-- Migration 001: Initial schema for VerseLink
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor).
-- ============================================================

-- pgvector adds a new column type: vector(n)
-- A vector is an array of floats representing a piece of text in "semantic space."
-- Texts with similar meaning end up close together when measured by cosine distance.
CREATE EXTENSION IF NOT EXISTS vector;

-- verses: one row per Bible verse (World English Bible, ~31,000 rows)
-- The embedding column is NULL until Day 2 when we run the Gemini pipeline.
-- vector(768) matches the output dimension of Gemini text-embedding-004 exactly.
CREATE TABLE IF NOT EXISTS verses (
  id        BIGSERIAL PRIMARY KEY,
  book      TEXT        NOT NULL,
  chapter   INTEGER     NOT NULL,
  verse     INTEGER     NOT NULL,
  text      TEXT        NOT NULL,
  -- 768 dimensions = Gemini text-embedding-004 output size. NOT 1536 (that's OpenAI).
  embedding vector(768)
);

-- Unique constraint so the load script can re-run safely (ON CONFLICT DO NOTHING)
CREATE UNIQUE INDEX IF NOT EXISTS verses_book_chapter_verse_idx
  ON verses (book, chapter, verse);

-- ============================================================
-- Day 2: Run this AFTER the embed-bible.ts script finishes.
-- HNSW (Hierarchical Navigable Small World) is a graph-based index for
-- approximate nearest-neighbor search. It's much faster than scanning all
-- 31k rows, at the cost of occasionally missing the absolute best match.
-- vector_cosine_ops means we measure distance by cosine similarity.
-- ============================================================
-- CREATE INDEX ON verses USING hnsw (embedding vector_cosine_ops);

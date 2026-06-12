-- ============================================================
-- Migration 007: verse_translations table
-- Stores Bible verses from multiple translations fetched via
-- the Free Use Bible API (bible.helloao.org).
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor).
-- ============================================================

CREATE TABLE IF NOT EXISTS verse_translations (
  id      BIGSERIAL   PRIMARY KEY,
  book    TEXT        NOT NULL,
  chapter INTEGER     NOT NULL,
  verse   INTEGER     NOT NULL,
  version TEXT        NOT NULL,
  text    TEXT        NOT NULL
);

-- Unique constraint so load scripts can re-run safely (ON CONFLICT DO NOTHING).
-- Covers all four columns that together identify one unique verse in one translation.
CREATE UNIQUE INDEX IF NOT EXISTS verse_translations_book_chapter_verse_version_idx
  ON verse_translations (book, chapter, verse, version);

-- Lookup index: queries always filter by version first, then narrow to a passage.
CREATE INDEX IF NOT EXISTS verse_translations_version_book_chapter_idx
  ON verse_translations (version, book, chapter);

-- This table is written only by server-side scripts using the service_role key.
-- Disable RLS so the service_role key doesn't need explicit INSERT policies.
ALTER TABLE verse_translations DISABLE ROW LEVEL SECURITY;
